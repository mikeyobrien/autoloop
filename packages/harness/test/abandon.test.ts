import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { appendRegistryEntry } from "@mobrienv/autoloop-core/registry/update";
import { abandonRun } from "@mobrienv/autoloop-harness/abandon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;
let regPath: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `abandon-test-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  regPath = join(tmpDir, "registry.jsonl");
  journalPath = join(tmpDir, "journal.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "parked-run-1",
    status: "waiting",
    preset: "pstack",
    objective: "park",
    trigger: "cli",
    project_dir: tmpDir,
    work_dir: tmpDir,
    state_dir: join(tmpDir, ".autoloop", "runs", "parked-run-1"),
    journal_file: journalPath,
    parent_run_id: "",
    backend: "command",
    backend_args: [],
    created_at: "2026-09-15T00:00:00.000Z",
    updated_at: "2026-09-15T00:05:00.000Z",
    iteration: 3,
    max_iterations: 40,
    stop_reason: "waiting",
    latest_event: "loop.stop",
    isolation_mode: "run-scoped",
    worktree_name: "",
    worktree_path: "",
    pid: 999,
    outcome: "stopped",
    acceptance_verified: false,
    verdict: "",
    cost_usd: 0,
    ...overrides,
  };
}

function registryLines(): RunRecord[] {
  return readFileSync(regPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunRecord);
}

function topics(): string[] {
  return readFileSync(journalPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return (JSON.parse(line) as { topic?: string }).topic ?? "";
      } catch {
        return "";
      }
    });
}

function seedParked(): RunRecord {
  const record = makeRecord();
  appendRegistryEntry(regPath, makeRecord({ status: "running", pid: 999 }));
  appendRegistryEntry(regPath, record);
  appendEvent(
    journalPath,
    record.run_id,
    "3",
    "wait.open",
    jsonField("wait_id", "w-1") + ", " + jsonField("duration", "0s"),
  );
  appendEvent(
    journalPath,
    record.run_id,
    "3",
    "loop.stop",
    jsonField("reason", "waiting"),
  );
  return record;
}

describe("abandonRun (T-033 retire path)", () => {
  it("refuses a non-waiting run and writes NOTHING", () => {
    const before = "sentinel-no-writes";
    writeFileSync(regPath, before);
    const completed = makeRecord({
      status: "completed",
      stop_reason: "task.complete",
    });
    const res = abandonRun(completed, {
      registryFile: regPath,
      journalFile: journalPath,
      reason: "nope",
    });
    expect("error" in res && res.error).toContain("completed, not waiting");
    expect(readFileSync(regPath, "utf-8")).toBe(before);
    expect(existsSync(journalPath)).toBe(false);
  });

  it("refuses a running run and writes NOTHING", () => {
    writeFileSync(regPath, "sentinel");
    const running = makeRecord({ status: "running", stop_reason: "" });
    const res = abandonRun(running, {
      registryFile: regPath,
      journalFile: journalPath,
      reason: "nope",
    });
    expect("error" in res).toBe(true);
    expect(readFileSync(regPath, "utf-8")).toBe("sentinel");
  });

  it("appends a corrected stopped/abandoned registry entry and journals the transition", () => {
    const record = seedParked();
    const res = abandonRun(record, {
      registryFile: regPath,
      journalFile: journalPath,
      reason: "junk test park",
    });
    expect("error" in res).toBe(false);

    const lines = registryLines();
    expect(lines.length).toBe(3); // append-only: running + waiting + corrected
    const last = lines[lines.length - 1];
    expect(last.run_id).toBe("parked-run-1");
    expect(last.status).toBe("stopped");
    expect(last.stop_reason).toBe("abandoned");
    expect(last.pid).toBeUndefined();
    expect(last.outcome).toBe("stopped");
    expect(last.acceptance_verified).toBe(false);
    expect(last.latest_event).toBe("loop.stop");
    // untouched history preserved (append-only discipline)
    expect(lines[0].status).toBe("running");
    expect(lines[1].status).toBe("waiting");

    const t = topics();
    expect(t).toContain("wait.open");
    expect(t).toContain("wait.close"); // open wait closed exactly once
    expect(t).toContain("loop.stop");
    expect(t.filter((x) => x === "wait.close").length).toBe(1);
  });

  it("journal correction makes a rebuild end at stopped, not waiting", async () => {
    const record = seedParked();
    // Real journals begin with loop.start — derive only tracks runs it has
    // seen started, so seed one the way the engine writes it.
    appendEvent(
      journalPath,
      record.run_id,
      "",
      "loop.start",
      jsonField("preset", "pstack") +
        ", " +
        jsonField("objective", "park") +
        ", " +
        jsonField("created_at", record.created_at),
    );
    abandonRun(record, {
      registryFile: regPath,
      journalFile: journalPath,
      reason: "rebuild probe",
    });
    const { deriveRunRecords } = await import(
      "@mobrienv/autoloop-core/registry/derive"
    );
    const derived = deriveRunRecords(
      readFileSync(journalPath, "utf-8").split("\n"),
    );
    const mine = derived.find((r) => r.run_id === "parked-run-1");
    expect(mine?.status).toBe("stopped");
    expect(mine?.stop_reason).toBe("abandoned");
  });

  it("writes the correction next to the run's own journal (worktree-style layout)", () => {
    // Engine parked with a run-scoped journal: correction must land beside it,
    // not in the CLI's top-level registry.
    const runScopedJournal = join(
      tmpDir,
      "runs",
      "parked-run-1",
      "journal.jsonl",
    );
    mkdirSync(join(tmpDir, "runs", "parked-run-1"), { recursive: true });
    const record = makeRecord({ journal_file: runScopedJournal });
    appendRegistryEntry(regPath, record);
    appendEvent(
      runScopedJournal,
      record.run_id,
      "1",
      "wait.open",
      jsonField("wait_id", "w-2"),
    );
    const res = abandonRun(record, {
      registryFile: regPath,
      journalFile: journalPath,
      reason: "layout probe",
    });
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.registryFile).toBe(
        join(tmpDir, "runs", "parked-run-1", "registry.jsonl"),
      );
    }
    expect(
      existsSync(join(tmpDir, "runs", "parked-run-1", "registry.jsonl")),
    ).toBe(true);
  });
});
