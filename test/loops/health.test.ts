import { describe, it, expect } from "vitest";
import { categorizeRecords } from "../../src/loops/health.js";
import type { RunRecord } from "../../src/registry/types.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-test-001",
    status: "running",
    preset: "autocode",
    objective: "test",
    trigger: "cli",
    project_dir: "/tmp",
    work_dir: "/tmp",
    state_dir: "/tmp/.autoloop",
    journal_file: "/tmp/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: "2026-04-06T12:00:00Z",
    updated_at: "2026-04-06T12:00:00Z",
    iteration: 1,
    stop_reason: "",
    latest_event: "iteration.finish",
    isolation_mode: "",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

const NOW = new Date("2026-04-06T12:00:00Z").getTime();

describe("categorizeRecords", () => {
  it("treats autospec run 8min quiet as active (not stuck)", () => {
    // autospec stuckAfterMs = 20min, warningAfterMs = 10min
    const records = [
      makeRun({ preset: "autospec", updated_at: new Date(NOW - 8 * 60 * 1000).toISOString() }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
    expect(result.stuck).toHaveLength(0);
    expect(result.watching).toHaveLength(0);
  });

  it("puts autosimplify run 3min quiet into watching", () => {
    // autosimplify warningAfterMs = 2min, stuckAfterMs = 6min
    const records = [
      makeRun({ preset: "autosimplify", updated_at: new Date(NOW - 3 * 60 * 1000).toISOString() }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.watching).toHaveLength(1);
    expect(result.stuck).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("puts autosimplify run 7min quiet into stuck", () => {
    // autosimplify stuckAfterMs = 6min
    const records = [
      makeRun({ preset: "autosimplify", updated_at: new Date(NOW - 7 * 60 * 1000).toISOString() }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.stuck).toHaveLength(1);
    expect(result.watching).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("classifies failed and completed runs into recent buckets", () => {
    const records = [
      makeRun({ status: "failed", updated_at: new Date(NOW - 60 * 1000).toISOString() }),
      makeRun({ run_id: "run-test-002", status: "completed", updated_at: new Date(NOW - 60 * 1000).toISOString() }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.recentFailed).toHaveLength(1);
    expect(result.recentCompleted).toHaveLength(1);
  });

  it("treats runs with missing updated_at as active", () => {
    const records = [
      makeRun({ updated_at: "" }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
  });
});
