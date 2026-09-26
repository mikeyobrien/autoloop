import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchInspect } from "../../src/commands/inspect.js";

const TS = "2026-09-26T10:00:00.000Z";
const CANARY = "CANARY-SECRET-91c2";

let projectDir = "";

function record(run: string, topic: string, extra: Record<string, unknown>) {
  return JSON.stringify({ run, iteration: "1", topic, ts: TS, v: 1, ...extra });
}

function writeJournal(relPath: string, lines: string[]): void {
  const file = join(projectDir, relPath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
}

function routingLines(run: string): string[] {
  return [
    record(run, "loop.start", { fields: { prompt: CANARY } }),
    record(run, "iteration.start", {
      fields: {
        recent_event: "loop.start",
        suggested_roles: "builder",
        allowed_events: "task.done",
        backpressure: "",
        prompt: CANARY,
      },
    }),
    record(run, "task.done", { payload: CANARY, source: "agent" }),
  ];
}

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    stderr.push(String(s));
    return true;
  });
  dispatchInspect(["handoffs", ...args]);
  return {
    stdout: stdout.join("\n"),
    stderr: stderr.join(""),
    code: Number(process.exitCode ?? 0),
  };
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "autoloop-handoffs-"));
  process.env.AUTOLOOP_PROJECT_DIR = projectDir;
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env.AUTOLOOP_PROJECT_DIR;
  process.exitCode = 0;
});

describe("inspect handoffs", () => {
  it("prints one versioned JSON document for a run-scoped journal", () => {
    writeJournal(".autoloop/runs/r1/journal.jsonl", routingLines("r1"));
    const result = run(["r1", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema_version: 1,
      run_id: "r1",
      ordering: "journal_input",
      completeness: "not_established",
      observations: [
        {
          ordinal: 1,
          iteration: "1",
          timestamp: TS,
          actor_role: { status: "unknown" },
          decision_maker: { status: "unknown" },
          kind: "decision",
          recent_event: "loop.start",
          suggested_roles: ["builder"],
          allowed_events: ["task.done"],
          backpressure_present: false,
        },
        {
          ordinal: 2,
          iteration: "1",
          timestamp: TS,
          actor_role: { status: "unknown" },
          decision_maker: { status: "unknown" },
          kind: "accepted",
          event: "task.done",
          source: "agent",
        },
      ],
    });
    expect(result.stdout).not.toContain(CANARY);
  });

  it("gives the same report for positional, --run, and --format json selectors", () => {
    writeJournal(".autoloop/runs/r1/journal.jsonl", routingLines("r1"));
    const positional = run(["r1", "--json"]).stdout;
    vi.restoreAllMocks();
    const flag = run(["--run", "r1", "--format", "json"]).stdout;
    vi.restoreAllMocks();
    const both = run(["r1", "--run", "r1", "--json"]).stdout;
    expect(JSON.parse(positional).observations).toHaveLength(2);
    expect(flag).toBe(positional);
    expect(both).toBe(positional);
  });

  it("reads a worktree journal and renders terminal rows by default", () => {
    writeJournal(
      ".autoloop/worktrees/wt1/tree/.autoloop/journal.jsonl",
      routingLines("wt1"),
    );
    const result = run(["wt1"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "## Handoffs: wt1",
        "Order: journal input. Completeness: not established. Actor and decision maker: unknown.",
        "",
        `#1 iter 1 ${TS} decision recent_event=loop.start suggested_roles=[builder] allowed_events=[task.done] backpressure_present=false`,
        `#2 iter 1 ${TS} accepted event=task.done source=agent`,
      ].join("\n"),
    );
  });

  it("falls back to the shared journal and ignores other runs in it", () => {
    writeJournal(".autoloop/journal.jsonl", [
      ...routingLines("other"),
      record("shared", "loop.start", { fields: {} }),
    ]);
    const result = run(["shared", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).observations).toEqual([]);
  });

  it("fails with exit 2 for a run with no journal records", () => {
    writeJournal(".autoloop/journal.jsonl", routingLines("other"));
    const result = run(["ghost", "--json"]);
    expect(result).toEqual({
      stdout: "",
      stderr: `error: run \`ghost\` not found in ${projectDir}\n`,
      code: 2,
    });
  });

  it.each([
    [[], "inspect handoffs requires a run id"],
    [["--run"], "--run requires a run id"],
    [["--run", ""], "--run requires a run id"],
    [["--run", "--all-runs"], "--run requires a run id"],
    [["--run", "--json", "r1"], "--run requires a run id"],
    [["r1", "--run", "r2"], "conflicting run selectors: r1, r2"],
    [["r1", "r2"], "conflicting run selectors: r1, r2"],
    [
      ["r1", "--all-runs"],
      "inspect handoffs reports one run; --all-runs is not supported",
    ],
    [["r1", "--topic", "x"], "unknown option `--topic`"],
    [["r1", "--format", "md"], "unsupported format `md` (terminal, json)"],
    [["r1", "--format"], "--format requires a value (terminal, json)"],
    [["r1", "--format", ""], "--format requires a value (terminal, json)"],
    [
      ["r1", "--format", "--all-runs"],
      "--format requires a value (terminal, json)",
    ],
  ])("rejects %j before reading any journal", (args, message) => {
    writeJournal(".autoloop/runs/r1/journal.jsonl", routingLines("r1"));
    const result = run(args);
    expect(result).toEqual({
      stdout: "",
      stderr: `error: ${message}\nUsage: autoloop inspect handoffs <run-id> [--json | --format terminal|json]\n`,
      code: 1,
    });
  });
});
