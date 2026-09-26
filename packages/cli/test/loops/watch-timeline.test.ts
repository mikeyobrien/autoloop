import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchRun } from "../../src/loops/watch.js";

const RUN = "watch-run-001";
const T0 = Date.parse("2026-09-26T20:00:00.000Z");
const INTERVAL = 100;

let stateDir: string;
let journal: string;
let logs: string[];
let writes: string[];

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: RUN,
    status: "running",
    preset: "autocode",
    objective: "watch me",
    trigger: "cli",
    project_dir: "/tmp/project",
    work_dir: "/tmp/project",
    state_dir: stateDir,
    journal_file: journal,
    parent_run_id: "",
    backend: "pi",
    backend_args: [],
    created_at: new Date(T0).toISOString(),
    updated_at: new Date(T0).toISOString(),
    iteration: 1,
    max_iterations: 10,
    stop_reason: "",
    latest_event: "iteration.finish",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function writeRegistry(records: RunRecord[]): void {
  writeFileSync(
    join(stateDir, "registry.jsonl"),
    records.map((r) => `${JSON.stringify(r)}\n`).join(""),
  );
}

function ev(
  iteration: string,
  topic: string,
  body: Record<string, unknown>,
  run = RUN,
): string {
  return `${JSON.stringify({ run, iteration, topic, ts: "", v: 1, ...body })}\n`;
}

function stepStart(n: number, role: string, recent: string): string {
  const ts = new Date(T0 + (n - 1) * 60_000).toISOString();
  return (
    `${JSON.stringify({
      run: RUN,
      iteration: String(n),
      topic: "iteration.start",
      ts,
      v: 1,
      fields: { suggested_roles: role, recent_event: recent },
    })}\n` +
    ev(String(n), "backend.start", {
      fields: { backend_kind: "pi", role, model: `model-${n}` },
    })
  );
}

function stepFinish(n: number, emitted: string, cost = 0): string {
  return (
    ev(String(n), emitted, { payload: "x", source: "agent" }) +
    ev(String(n), "backend.usage", { fields: { cost_usd: cost } }) +
    ev(String(n), "iteration.finish", {
      fields: { exit_code: "0", timed_out: false, elapsed_s: "60" },
    })
  );
}

function setTty(isTTY: boolean, columns?: number): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value: isTTY,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "columns", {
    value: columns,
    configurable: true,
  });
}

const savedTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const savedColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");

function restoreTty(): void {
  for (const [key, desc] of [
    ["isTTY", savedTty],
    ["columns", savedColumns],
  ] as const) {
    if (desc) Object.defineProperty(process.stdout, key, desc);
    else delete (process.stdout as unknown as Record<string, unknown>)[key];
  }
}

const output = (): string => logs.join("\n");
const count = (needle: string): number =>
  logs.filter((l) => l.includes(needle)).length;

beforeEach(() => {
  stateDir = join(tmpdir(), `watch-tl-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });
  journal = join(stateDir, "journal.jsonl");
  logs = [];
  writes = [];
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0 + 30_000);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  setTty(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreTty();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("watchRun timeline", () => {
  it("prints each finished step once as the journal grows, then the terminal block", async () => {
    writeFileSync(
      journal,
      stepStart(1, "planner", "loop.start") +
        stepFinish(1, "plan.ready", 0.25) +
        // noise from another run sharing the journal must be ignored
        ev("1", "iteration.start", { fields: {} }, "other-run") +
        stepStart(2, "builder", "plan.ready"),
    );
    writeRegistry([makeRecord()]);

    const done = watchRun(stateDir, "watch-run", INTERVAL);
    expect(output()).toContain(`[watch] Watching ${RUN} (autocode`);
    expect(count("#1")).toBe(1);
    expect(output()).toMatch(
      /#1\s+planner\s+1m00s\s+\$0\.25\s+loop\.start → plan\.ready\s+model-1/,
    );
    expect(output()).toMatch(/▶ #2\s+builder\s+0m00s\s+running\s+model-2/);

    // Tick with nothing new: no reprint of step 1 or the live line off-TTY.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(count("#1")).toBe(1);
    expect(count("▶ #2")).toBe(1);

    appendFileSync(
      journal,
      stepFinish(2, "review.ready") + stepStart(3, "critic", "review.ready"),
    );
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(count("#2 ")).toBe(2); // live line + finished line
    expect(output()).toMatch(
      /^#2\s+builder\s+1m00s\s+plan\.ready → review\.ready\s+model-2$/m,
    );
    expect(count("▶ #3")).toBe(1);

    appendFileSync(journal, stepFinish(3, "review.passed"));
    writeRegistry([
      makeRecord({ status: "completed", stop_reason: "done", iteration: 3 }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await done;

    expect(count("#1 ")).toBe(1);
    expect(count("#3 ")).toBe(2);
    expect(output()).toContain("[watch] Run completed.");
    expect(output()).toContain("done");
    expect(logs.indexOf("[watch] Run completed.")).toBeGreaterThan(
      logs.findIndex((l) => l.includes("review.passed")),
    );
    expect(writes).toEqual([]);
  });

  it("still prints lines when a PTY reports zero columns", async () => {
    setTty(true, 0);
    vi.stubEnv("COLUMNS", "");
    writeFileSync(journal, stepStart(1, "planner", "loop.start"));
    writeRegistry([makeRecord()]);

    const done = watchRun(stateDir, RUN, INTERVAL);
    expect(writes[0].startsWith("\r\x1b[2K▶ #1")).toBe(true);
    expect(writes[0]).toContain("planner");

    appendFileSync(journal, stepFinish(1, "plan.ready"));
    writeRegistry([makeRecord({ status: "completed" })]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await done;
    expect(output()).toMatch(/^#1\s+planner/m);
    vi.unstubAllEnvs();
  });

  it("rewrites the live line in place on a TTY and clears it before printing", async () => {
    setTty(true, 40);
    writeFileSync(journal, stepStart(1, "planner", "loop.start"));
    writeRegistry([makeRecord()]);

    const done = watchRun(stateDir, RUN, INTERVAL);
    expect(writes).toHaveLength(1);
    expect(writes[0].startsWith("\r\x1b[2K▶ #1")).toBe(true);
    expect([...writes[0].slice("\r\x1b[2K".length)]).toHaveLength(40);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(writes).toHaveLength(2); // redrawn every tick
    expect(logs.filter((l) => l.includes("▶"))).toEqual([]);

    appendFileSync(journal, stepFinish(1, "plan.ready"));
    writeRegistry([makeRecord({ status: "failed", stop_reason: "boom" })]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await done;

    // The live line was cleared before the finished step printed.
    expect(writes[2]).toBe("\r\x1b[2K");
    expect(count("#1 ")).toBe(1);
    expect(output()).toContain("[watch] Run failed.");
  });

  it("prints the full timeline before the detail block for an already-terminal run", async () => {
    writeFileSync(
      journal,
      stepStart(1, "planner", "loop.start") +
        stepFinish(1, "plan.ready") +
        stepStart(2, "builder", "plan.ready") +
        stepFinish(2, "task.complete"),
    );
    writeRegistry([makeRecord({ status: "completed", stop_reason: "done" })]);

    await watchRun(stateDir, RUN, INTERVAL);

    const already = logs.indexOf("[watch] Run already completed.");
    expect(already).toBe(2);
    expect(logs[0]).toMatch(/^#1 /);
    expect(logs[1]).toMatch(/^#2 .*task\.complete/);
    expect(output()).toContain(RUN);
  });

  it("falls back to the run-scoped journal when the record has no journal_file", async () => {
    const runDir = join(stateDir, "runs", RUN);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "journal.jsonl"),
      stepStart(1, "planner", "loop.start") + stepFinish(1, "plan.ready"),
    );
    writeRegistry([makeRecord({ status: "stopped", journal_file: "" })]);

    await watchRun(stateDir, RUN, INTERVAL);
    expect(count("#1 ")).toBe(1);
  });

  it("prints no steps when no journal can be found", async () => {
    writeRegistry([makeRecord({ status: "stopped", journal_file: "" })]);
    await watchRun(stateDir, RUN, INTERVAL);
    expect(logs[0]).toBe("[watch] Run already stopped.");
  });

  it("reports a run that vanishes from the registry", async () => {
    writeFileSync(journal, "");
    writeRegistry([makeRecord()]);
    const done = watchRun(stateDir, RUN, INTERVAL);
    writeRegistry([]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await done;
    expect(output()).toContain(`[watch] No run matching '${RUN}'.`);
  });

  it("prints a health advisory when the run goes quiet", async () => {
    writeFileSync(journal, stepStart(1, "planner", "loop.start"));
    writeRegistry([
      makeRecord({ updated_at: new Date(T0 + 30_000).toISOString() }),
    ]);
    const done = watchRun(stateDir, RUN, INTERVAL);
    vi.setSystemTime(T0 + 30_000 + 6 * 60_000);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(output()).toContain("no progress for 6m");
    process.emit("SIGINT");
    await done;
  });

  it("stops on SIGINT and clears the TTY live line first", async () => {
    setTty(true);
    writeFileSync(journal, stepStart(1, "planner", "loop.start"));
    writeRegistry([makeRecord()]);
    const listeners = process.listenerCount("SIGINT");
    const done = watchRun(stateDir, RUN, INTERVAL);
    expect(process.listenerCount("SIGINT")).toBe(listeners + 1);
    process.emit("SIGINT");
    await done;
    expect(process.listenerCount("SIGINT")).toBe(listeners);
    expect(writes.at(-1)).toBe("\r\x1b[2K");
    expect(output()).toContain("[watch] Interrupted.");
  });

  it("prints unknown-run messages without watching", async () => {
    writeRegistry([]);
    await watchRun(stateDir, "nope", INTERVAL);
    expect(logs).toEqual(["No run matching 'nope'."]);
  });
});
