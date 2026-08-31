import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, describe, expect, it } from "vitest";
import { categorizeRecords, healthSummary } from "../../src/loops/health.js";

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

describe("categorizeRecords", () => {
  it("treats autospec run 8min quiet as active (not stuck)", () => {
    // autospec stuckAfterMs = 20min, warningAfterMs = 10min
    const records = [
      makeRun({
        preset: "autospec",
        updated_at: new Date(NOW - 8 * 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
    expect(result.stuck).toHaveLength(0);
    expect(result.watching).toHaveLength(0);
  });

  it("puts autosimplify run 3min quiet into watching", () => {
    // autosimplify warningAfterMs = 2min, stuckAfterMs = 6min
    const records = [
      makeRun({
        preset: "autosimplify",
        updated_at: new Date(NOW - 3 * 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.watching).toHaveLength(1);
    expect(result.stuck).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("puts autosimplify run 7min quiet into stuck", () => {
    // autosimplify stuckAfterMs = 6min
    const records = [
      makeRun({
        preset: "autosimplify",
        updated_at: new Date(NOW - 7 * 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.stuck).toHaveLength(1);
    expect(result.watching).toHaveLength(0);
    expect(result.active).toHaveLength(0);
  });

  it("classifies failed and completed runs into recent buckets", () => {
    const records = [
      makeRun({
        status: "failed",
        updated_at: new Date(NOW - 60 * 1000).toISOString(),
      }),
      makeRun({
        run_id: "run-test-002",
        status: "completed",
        updated_at: new Date(NOW - 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.recentFailed).toHaveLength(1);
    expect(result.recentCompleted).toHaveLength(1);
  });

  it("treats runs with missing updated_at as active", () => {
    const records = [makeRun({ updated_at: "" })];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
  });

  it("reclassifies running record with dead PID as not active", () => {
    // Use a PID that definitely doesn't exist
    const records = [
      makeRun({
        pid: 2147483647,
        updated_at: new Date(NOW - 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(0);
    expect(result.watching).toHaveLength(0);
    expect(result.stuck).toHaveLength(0);
  });

  it("keeps running record with live PID as active", () => {
    const records = [
      makeRun({
        pid: process.pid,
        updated_at: new Date(NOW - 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
  });

  it("keeps running record without PID as active (backward compat)", () => {
    const records = [
      makeRun({ updated_at: new Date(NOW - 60 * 1000).toISOString() }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.active).toHaveLength(1);
  });

  it("classifies status=waiting with no PID as waiting, not dropped", () => {
    const records = [
      makeRun({
        run_id: "run-wait-parked",
        status: "waiting",
        stop_reason: "waiting",
        latest_event: "wait.open",
        updated_at: new Date(NOW - 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.waiting).toHaveLength(1);
    expect(result.waiting[0].run_id).toBe("run-wait-parked");
    expect(result.active).toHaveLength(0);
    expect(result.watching).toHaveLength(0);
    expect(result.stuck).toHaveLength(0);
    expect(result.recentFailed).toHaveLength(0);
    expect(result.recentCompleted).toHaveLength(0);
  });

  it("keeps parked waiting runs even when older than the 24h recent window", () => {
    const records = [
      makeRun({
        run_id: "run-wait-old",
        status: "waiting",
        stop_reason: "waiting",
        updated_at: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.waiting).toHaveLength(1);
    expect(result.waiting[0].run_id).toBe("run-wait-old");
  });

  it("does not move waiting runs into watching or stuck by age", () => {
    const records = [
      makeRun({
        run_id: "run-wait-long",
        status: "waiting",
        preset: "autosimplify",
        stop_reason: "waiting",
        updated_at: new Date(NOW - 20 * 60 * 1000).toISOString(),
      }),
    ];
    const result = categorizeRecords(records, NOW);
    expect(result.waiting).toHaveLength(1);
    expect(result.watching).toHaveLength(0);
    expect(result.stuck).toHaveLength(0);
  });
});

describe("healthSummary waiting bucket", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function writeRegistry(records: RunRecord[]): string {
    const stateDir = join(
      tmpdir(),
      `health-wait-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(stateDir, { recursive: true });
    dirs.push(stateDir);
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
    return stateDir;
  }

  it("lists a parked waiting run in the WAITING section", () => {
    const stateDir = writeRegistry([
      makeRun({
        run_id: "run-wait-health",
        status: "waiting",
        stop_reason: "waiting",
        latest_event: "wait.open",
        updated_at: new Date().toISOString(),
      }),
    ]);
    const output = healthSummary(stateDir, false);
    expect(output).toContain("WAITING:");
    expect(output).toContain("run-wait-health");
    expect(output).toMatch(/1 waiting/);
    expect(output).not.toContain("All clear");
  });
});
