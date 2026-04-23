import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showArtifacts, showRun } from "../../src/loops/show.js";

function makeRecord(id: string, preset = "autocode"): RunRecord {
  return {
    run_id: id,
    status: "completed",
    preset,
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
  };
}

let tmpDir: string;
let regPath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `show-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  regPath = join(tmpDir, "registry.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("showRun", () => {
  it("returns no-match message for unknown ID", () => {
    writeFileSync(regPath, `${JSON.stringify(makeRecord("abc-123"))}\n`);
    const result = showRun(tmpDir, "zzz");
    expect(result).toContain("No run matching");
    expect(result).toContain("zzz");
  });

  it("returns ambiguous message when prefix matches multiple runs", () => {
    const lines = `${[
      JSON.stringify(makeRecord("abc-111")),
      JSON.stringify(makeRecord("abc-222")),
    ].join("\n")}\n`;
    writeFileSync(regPath, lines);
    const result = showRun(tmpDir, "abc");
    expect(result).toContain("Ambiguous");
    expect(result).toContain("abc-111");
    expect(result).toContain("abc-222");
  });

  it("returns detail view for exact match", () => {
    writeFileSync(regPath, `${JSON.stringify(makeRecord("run-exact-001"))}\n`);
    const result = showRun(tmpDir, "run-exact-001");
    expect(result).toContain("run-exact-001");
    // Should render detail, not an error message
    expect(result).not.toContain("No run matching");
    expect(result).not.toContain("Ambiguous");
  });

  it("returns detail view for unique prefix match", () => {
    const lines = `${[
      JSON.stringify(makeRecord("aaa-111")),
      JSON.stringify(makeRecord("bbb-222")),
    ].join("\n")}\n`;
    writeFileSync(regPath, lines);
    const result = showRun(tmpDir, "aaa");
    expect(result).toContain("aaa-111");
    expect(result).not.toContain("Ambiguous");
  });
});

describe("showArtifacts", () => {
  it("returns no-match message for unknown ID", () => {
    writeFileSync(regPath, `${JSON.stringify(makeRecord("abc-123"))}\n`);
    const result = showArtifacts(tmpDir, "zzz");
    expect(result).toContain("No run matching");
  });

  it("returns ambiguous message when prefix matches multiple runs", () => {
    const lines = `${[
      JSON.stringify(makeRecord("abc-111")),
      JSON.stringify(makeRecord("abc-222")),
    ].join("\n")}\n`;
    writeFileSync(regPath, lines);
    const result = showArtifacts(tmpDir, "abc");
    expect(result).toContain("Ambiguous");
  });

  it("returns artifact paths for exact match", () => {
    writeFileSync(regPath, `${JSON.stringify(makeRecord("run-exact-001"))}\n`);
    const result = showArtifacts(tmpDir, "run-exact-001");
    expect(result).not.toContain("No run matching");
    expect(result).not.toContain("Ambiguous");
    // Should contain file paths from the record
    expect(result).toContain("journal");
  });
});
