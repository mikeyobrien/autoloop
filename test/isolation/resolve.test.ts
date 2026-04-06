import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { resolveIsolationMode, isCodeModifyingRun, presetCategory } from "../../src/isolation/resolve.js";
import type { RunRecord } from "../../src/registry/types.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-abc",
    status: "running",
    preset: "test",
    objective: "do a thing",
    trigger: "cli",
    project_dir: "/tmp/proj",
    work_dir: "/tmp/proj",
    state_dir: "/tmp/proj/.autoloop",
    journal_file: "/tmp/proj/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "echo",
    backend_args: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    iteration: 0,
    stop_reason: "",
    latest_event: "loop.start",
    isolation_mode: "shared",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

describe("resolveIsolationMode", () => {
  it("returns shared when solo run with no flags", () => {
    const result = resolveIsolationMode({}, []);
    expect(result).toEqual({ mode: "shared" });
  });

  it("returns worktree when --worktree flag is set", () => {
    const result = resolveIsolationMode({ worktree: true }, []);
    expect(result).toEqual({ mode: "worktree" });
  });

  it("returns shared when --no-worktree flag is set even with active runs", () => {
    const result = resolveIsolationMode({ noWorktree: true }, [makeRecord()]);
    expect(result).toEqual({ mode: "shared" });
  });

  it("returns worktree when config enabled (worktree.enabled or isolation.enabled)", () => {
    const result = resolveIsolationMode({ configEnabled: true }, []);
    expect(result).toEqual({ mode: "worktree" });
  });

  it("returns shared when config enabled but --no-worktree overrides", () => {
    const result = resolveIsolationMode({ configEnabled: true, noWorktree: true }, []);
    expect(result).toEqual({ mode: "shared" });
  });

  it("--worktree takes priority over --no-worktree", () => {
    const result = resolveIsolationMode({ worktree: true, noWorktree: true }, []);
    expect(result).toEqual({ mode: "worktree" });
  });

  it("returns run-scoped when other active runs exist", () => {
    const result = resolveIsolationMode({}, [makeRecord()]);
    expect(result).toEqual({ mode: "run-scoped" });
  });

  it("returns run-scoped with warning when code-modifying runs are active", () => {
    const result = resolveIsolationMode({}, [makeRecord({ preset: "autocode" })]);
    expect(result.mode).toBe("run-scoped");
    expect(result.warning).toContain("code-modifying");
  });

  it("returns run-scoped without warning for non-code active runs", () => {
    const result = resolveIsolationMode({}, [makeRecord({ preset: "diagnostics", objective: "check logs" })]);
    expect(result.mode).toBe("run-scoped");
    expect(result.warning).toBeUndefined();
  });
});

describe("isCodeModifyingRun", () => {
  it("detects autocode preset", () => {
    expect(isCodeModifyingRun(makeRecord({ preset: "autocode" }))).toBe(true);
  });

  it("detects builder in preset", () => {
    expect(isCodeModifyingRun(makeRecord({ preset: "builder-v2" }))).toBe(true);
  });

  it("detects fix in objective", () => {
    expect(isCodeModifyingRun(makeRecord({ objective: "fix the login bug" }))).toBe(true);
  });

  it("detects implement in objective", () => {
    expect(isCodeModifyingRun(makeRecord({ objective: "implement caching" }))).toBe(true);
  });

  it("returns false for non-code runs", () => {
    expect(isCodeModifyingRun(makeRecord({ preset: "diagnostics", objective: "check logs" }))).toBe(false);
  });

  it("respects category override code", () => {
    expect(isCodeModifyingRun(makeRecord({ preset: "diagnostics", objective: "check logs" }), "code")).toBe(true);
  });

  it("respects category override planning", () => {
    expect(isCodeModifyingRun(makeRecord({ preset: "autocode" }), "planning")).toBe(false);
  });
});

describe("presetCategory", () => {
  it("reads category from automerge harness.md metadata", () => {
    expect(presetCategory("automerge", bundleRoot)).toBe("planning");
  });

  it("falls back to name heuristic for code presets", () => {
    expect(presetCategory("autocode", bundleRoot)).toBe("code");
    expect(presetCategory("autofix", bundleRoot)).toBe("code");
    expect(presetCategory("autotest", bundleRoot)).toBe("code");
  });

  it("falls back to name heuristic for planning presets", () => {
    expect(presetCategory("autoresearch", bundleRoot)).toBe("planning");
    expect(presetCategory("autodoc", bundleRoot)).toBe("planning");
  });

  it("returns unknown for unrecognized presets", () => {
    expect(presetCategory("nonexistent-xyz", bundleRoot)).toBe("unknown");
  });
});
