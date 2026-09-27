import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { resumeProblem } from "@mobrienv/autoloop-harness";
import { describe, expect, it } from "vitest";

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-resume-problem-"));
  const stateDir = join(dir, ".autoloop");
  mkdirSync(stateDir);
  const journal = join(stateDir, "journal.jsonl");
  writeFileSync(journal, "");
  return {
    run_id: "run-a",
    status: "stopped",
    journal_file: journal,
    state_dir: stateDir,
    isolation_mode: "run-scoped",
    ...overrides,
  } as RunRecord;
}

describe("resumeProblem", () => {
  it("accepts a stopped run with its journal and state dir", () => {
    expect(resumeProblem(record())).toBeNull();
  });

  it("accepts a running record whose pid is dead", () => {
    expect(
      resumeProblem(record({ status: "running", pid: 2 ** 22 + 7 })),
    ).toBeNull();
  });

  it.each([
    [{ status: "completed" }, "run run-a already completed; cannot resume"],
    [
      { status: "running", pid: process.pid },
      `run run-a is still running (PID ${process.pid})`,
    ],
    [{ journal_file: "" }, "journal not found for run run-a"],
    [
      { journal_file: "/nonexistent/journal.jsonl" },
      "journal not found for run run-a",
    ],
    [
      { state_dir: "/nonexistent/state" },
      "state directory for run run-a not found",
    ],
    [
      { isolation_mode: "worktree", worktree_path: "" },
      "worktree for run run-a was cleaned up; cannot resume",
    ],
  ] as [Partial<RunRecord>, string][])("rejects %o", (overrides, message) => {
    expect(resumeProblem(record(overrides))).toBe(message);
  });

  it("falls back to the journal's directory when state_dir is unset", () => {
    expect(resumeProblem(record({ state_dir: "" }))).toBeNull();
  });
});
