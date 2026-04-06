import { describe, expect, it } from "vitest";
import { healthAdvisory } from "../../src/loops/watch.js";
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
    max_iterations: 10,
    stop_reason: "",
    latest_event: "iteration.finish",
    isolation_mode: "",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

const NOW = new Date("2026-04-06T12:00:00Z").getTime();

describe("healthAdvisory", () => {
  it("returns null for a healthy running run", () => {
    // autocode warningAfterMs = 5min; run is 2min old
    const r = makeRun({
      updated_at: new Date(NOW - 2 * 60 * 1000).toISOString(),
    });
    expect(healthAdvisory(r, NOW)).toBeNull();
  });

  it("returns investigate-soon for a watching-band run", () => {
    // autosimplify warningAfterMs = 2min, stuckAfterMs = 6min; run is 3min old
    const r = makeRun({
      preset: "autosimplify",
      updated_at: new Date(NOW - 3 * 60 * 1000).toISOString(),
    });
    const msg = healthAdvisory(r, NOW);
    expect(msg).toContain("autosimplify");
    expect(msg).toContain("investigate soon");
  });

  it("returns stuck advisory for a stuck run", () => {
    // autosimplify stuckAfterMs = 6min; run is 7min old
    const r = makeRun({
      preset: "autosimplify",
      updated_at: new Date(NOW - 7 * 60 * 1000).toISOString(),
    });
    const msg = healthAdvisory(r, NOW);
    expect(msg).toContain("autosimplify");
    expect(msg).toContain("likely stuck");
  });

  it("returns null for non-running runs", () => {
    const r = makeRun({ status: "completed" });
    expect(healthAdvisory(r, NOW)).toBeNull();
  });

  it("returns null when updated_at is missing", () => {
    const r = makeRun({ updated_at: "" });
    expect(healthAdvisory(r, NOW)).toBeNull();
  });
});
