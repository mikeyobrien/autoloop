import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../../src/registry/types.js";
import { appendRegistryEntry } from "../../src/registry/update.js";
import { readRegistry, getRun, activeRuns, recentRuns } from "../../src/registry/read.js";

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-1",
    status: "running",
    preset: "test",
    objective: "do thing",
    trigger: "cli",
    project_dir: "/tmp/proj",
    work_dir: "/tmp/proj",
    state_dir: "/tmp/proj/.autoloop",
    journal_file: "/tmp/proj/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "echo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    iteration: 0,
    stop_reason: "",
    latest_event: "loop.start",
    ...overrides,
  };
}

describe("registry read/update", () => {
  let registryPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
    registryPath = join(dir, "registry.jsonl");
  });

  it("returns empty array for missing file", () => {
    expect(readRegistry(registryPath)).toEqual([]);
  });

  it("appends and reads a single entry", () => {
    const record = makeRecord();
    appendRegistryEntry(registryPath, record);
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
    expect(records[0].run_id).toBe("run-1");
    expect(records[0].status).toBe("running");
  });

  it("deduplicates by run_id, keeping last entry", () => {
    appendRegistryEntry(registryPath, makeRecord({ status: "running", iteration: 0 }));
    appendRegistryEntry(registryPath, makeRecord({ status: "running", iteration: 1 }));
    appendRegistryEntry(registryPath, makeRecord({ status: "completed", iteration: 1, stop_reason: "completion_event" }));
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
    expect(records[0].iteration).toBe(1);
  });

  it("tracks multiple runs independently", () => {
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-1", status: "completed" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-2", status: "running" }));
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(2);
  });

  it("getRun finds specific run", () => {
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-1" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-2" }));
    const run = getRun(registryPath, "run-2");
    expect(run?.run_id).toBe("run-2");
  });

  it("getRun returns undefined for missing run", () => {
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-1" }));
    expect(getRun(registryPath, "run-99")).toBeUndefined();
  });

  it("activeRuns filters to running status", () => {
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-1", status: "completed" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-2", status: "running" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-3", status: "failed" }));
    const active = activeRuns(registryPath);
    expect(active).toHaveLength(1);
    expect(active[0].run_id).toBe("run-2");
  });

  it("recentRuns returns sorted by updated_at descending, limited", () => {
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-1", updated_at: "2026-01-01T00:00:00.000Z" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-2", updated_at: "2026-01-03T00:00:00.000Z" }));
    appendRegistryEntry(registryPath, makeRecord({ run_id: "run-3", updated_at: "2026-01-02T00:00:00.000Z" }));
    const recent = recentRuns(registryPath, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].run_id).toBe("run-2");
    expect(recent[1].run_id).toBe("run-3");
  });

  it("skips malformed JSON lines", () => {
    appendFileSync(registryPath, "not json\n", "utf-8");
    appendRegistryEntry(registryPath, makeRecord());
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
  });

  it("writes valid JSONL format", () => {
    appendRegistryEntry(registryPath, makeRecord());
    const raw = readFileSync(registryPath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.run_id).toBe("run-1");
  });
});
