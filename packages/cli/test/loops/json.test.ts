import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  artifactsJson,
  healthJson,
  listRunsJson,
  showRunJson,
} from "../../src/loops/json.js";

function makeRecord(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: id,
    status: "completed",
    preset: "autocode",
    objective: "test objective",
    trigger: "cli",
    project_dir: "/tmp/proj",
    work_dir: "/tmp/proj",
    state_dir: "/tmp/proj/.autoloop",
    journal_file: "/tmp/proj/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T01:00:00Z",
    iteration: 5,
    max_iterations: 10,
    stop_reason: "completion",
    latest_event: "loop.complete",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

let tmpDir: string;
let regPath: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `loops-json-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  regPath = join(tmpDir, "registry.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeRecords(records: RunRecord[]): void {
  writeFileSync(
    regPath,
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

describe("listRunsJson", () => {
  it("returns an empty array when no registry exists", () => {
    const parsed = JSON.parse(listRunsJson(tmpDir, false));
    expect(parsed).toEqual([]);
  });

  it("returns only running runs by default", () => {
    writeRecords([
      makeRecord("run-active-1", { status: "running" }),
      makeRecord("run-done-1", { status: "completed" }),
    ]);
    const parsed = JSON.parse(listRunsJson(tmpDir, false));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].run_id).toBe("run-active-1");
    expect(parsed[0].status).toBe("running");
  });

  it("projects exactly the table fields and omits empty worktree fields", () => {
    writeRecords([makeRecord("run-fields-1", { status: "running" })]);
    const parsed = JSON.parse(listRunsJson(tmpDir, false));
    expect(Object.keys(parsed[0]).sort()).toEqual(
      [
        "run_id",
        "status",
        "preset",
        "iteration",
        "max_iterations",
        "stop_reason",
        "latest_event",
        "created_at",
        "updated_at",
        "isolation_mode",
      ].sort(),
    );
    expect(parsed[0].iteration).toBe(5);
    expect(parsed[0].max_iterations).toBe(10);
  });

  it("includes worktree fields when present", () => {
    writeRecords([
      makeRecord("run-wt-1", {
        status: "running",
        isolation_mode: "worktree",
        worktree_name: "wt-feature",
        worktree_path: "/tmp/proj/.worktrees/wt-feature",
        worktree_merged: true,
        worktree_merged_at: "2026-01-02T00:00:00Z",
        worktree_merge_strategy: "squash",
      }),
    ]);
    const parsed = JSON.parse(listRunsJson(tmpDir, false));
    expect(parsed[0].isolation_mode).toBe("worktree");
    expect(parsed[0].worktree_name).toBe("wt-feature");
    expect(parsed[0].worktree_path).toBe("/tmp/proj/.worktrees/wt-feature");
    expect(parsed[0].worktree_merged).toBe(true);
    expect(parsed[0].worktree_merged_at).toBe("2026-01-02T00:00:00Z");
    expect(parsed[0].worktree_merge_strategy).toBe("squash");
  });

  it("returns all runs sorted by updated_at descending with all=true", () => {
    writeRecords([
      makeRecord("run-old", { updated_at: "2026-01-01T01:00:00Z" }),
      makeRecord("run-new", { updated_at: "2026-01-03T01:00:00Z" }),
      makeRecord("run-mid", { updated_at: "2026-01-02T01:00:00Z" }),
    ]);
    const parsed = JSON.parse(listRunsJson(tmpDir, true));
    expect(parsed.map((r: { run_id: string }) => r.run_id)).toEqual([
      "run-new",
      "run-mid",
      "run-old",
    ]);
  });
});

describe("showRunJson", () => {
  it("returns the full record plus a derived health bucket", () => {
    writeRecords([
      makeRecord("run-show-1", {
        status: "running",
        updated_at: isoAgo(0),
      }),
    ]);
    const { output, exitCode } = showRunJson(tmpDir, "run-show-1");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.run_id).toBe("run-show-1");
    expect(parsed.objective).toBe("test objective");
    expect(parsed.backend).toBe("mock");
    expect(parsed.work_dir).toBe("/tmp/proj");
    expect(parsed.health).toBe("active");
  });

  it("derives recent_completed for a recently completed run", () => {
    writeRecords([
      makeRecord("run-done-recent", {
        status: "completed",
        updated_at: isoAgo(60 * 60 * 1000),
      }),
    ]);
    const parsed = JSON.parse(showRunJson(tmpDir, "run-done-recent").output);
    expect(parsed.health).toBe("recent_completed");
  });

  it("derives null health for runs outside every bucket", () => {
    writeRecords([
      makeRecord("run-ancient", {
        status: "completed",
        updated_at: isoAgo(48 * 60 * 60 * 1000),
      }),
    ]);
    const parsed = JSON.parse(showRunJson(tmpDir, "run-ancient").output);
    expect(parsed.health).toBeNull();
  });

  it("resolves unique prefixes", () => {
    writeRecords([makeRecord("aaa-111"), makeRecord("bbb-222")]);
    const { output, exitCode } = showRunJson(tmpDir, "aaa");
    expect(exitCode).toBe(0);
    expect(JSON.parse(output).run_id).toBe("aaa-111");
  });

  it("returns an error object and exit code 1 for unknown ids", () => {
    writeRecords([makeRecord("abc-123")]);
    const { output, exitCode } = showRunJson(tmpDir, "zzz");
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output);
    expect(parsed.error).toContain("No run matching");
    expect(parsed.error).toContain("zzz");
  });

  it("returns an error object with matches for ambiguous prefixes", () => {
    writeRecords([makeRecord("abc-111"), makeRecord("abc-222")]);
    const { output, exitCode } = showRunJson(tmpDir, "abc");
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output);
    expect(parsed.error).toContain("Ambiguous");
    expect(parsed.matches).toEqual(["abc-111", "abc-222"]);
  });
});

describe("artifactsJson", () => {
  it("returns artifact paths for a matching run", () => {
    writeRecords([makeRecord("run-art-1")]);
    const { output, exitCode } = artifactsJson(tmpDir, "run-art-1");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      run_id: "run-art-1",
      journal_file: "/tmp/proj/.autoloop/journal.jsonl",
      state_dir: "/tmp/proj/.autoloop",
      work_dir: "/tmp/proj",
    });
  });

  it("returns an error object and exit code 1 for unknown ids", () => {
    writeRecords([makeRecord("run-art-1")]);
    const { output, exitCode } = artifactsJson(tmpDir, "zzz");
    expect(exitCode).toBe(1);
    expect(JSON.parse(output).error).toContain("No run matching");
  });
});

describe("healthJson", () => {
  it("buckets runs with counts and run ids", () => {
    // autocode policy: warning after 5min, stuck after 12min.
    writeRecords([
      makeRecord("run-active", { status: "running", updated_at: isoAgo(0) }),
      makeRecord("run-watching", {
        status: "running",
        updated_at: isoAgo(7 * 60 * 1000),
      }),
      makeRecord("run-stuck", {
        status: "running",
        updated_at: isoAgo(20 * 60 * 1000),
      }),
      makeRecord("run-failed", {
        status: "failed",
        updated_at: isoAgo(60 * 60 * 1000),
      }),
      makeRecord("run-completed", {
        status: "completed",
        updated_at: isoAgo(60 * 60 * 1000),
      }),
    ]);
    const parsed = JSON.parse(healthJson(tmpDir));
    expect(parsed.active).toEqual({ count: 1, run_ids: ["run-active"] });
    expect(parsed.watching).toEqual({ count: 1, run_ids: ["run-watching"] });
    expect(parsed.stuck).toEqual({ count: 1, run_ids: ["run-stuck"] });
    expect(parsed.recent_failed).toEqual({
      count: 1,
      run_ids: ["run-failed"],
    });
    expect(parsed.recent_completed).toEqual({
      count: 1,
      run_ids: ["run-completed"],
    });
  });

  it("returns zeroed buckets when no registry exists", () => {
    const parsed = JSON.parse(healthJson(tmpDir));
    for (const key of [
      "active",
      "watching",
      "stuck",
      "recent_failed",
      "recent_completed",
    ]) {
      expect(parsed[key]).toEqual({ count: 0, run_ids: [] });
    }
  });
});
