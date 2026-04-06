import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  readRegistry,
  getRun,
  activeRuns,
  recentRuns,
  findRunByPrefix,
} from "../../src/registry/read.js";

const tmpDir = join(import.meta.dirname ?? ".", ".tmp-registry-read-test");
const regFile = join(tmpDir, "registry.jsonl");

function makeRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    run_id: "run-1",
    status: "completed",
    preset: "default",
    objective: "",
    trigger: "",
    project_dir: "/tmp",
    work_dir: "/tmp",
    state_dir: "/tmp",
    journal_file: "/tmp/j.jsonl",
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    iteration: 1,
    stop_reason: "",
    latest_event: "",
    isolation_mode: "",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function writeReg(records: Record<string, unknown>[]) {
  writeFileSync(regFile, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("readRegistry", () => {
  it("returns empty for missing file", () => {
    expect(readRegistry(join(tmpDir, "nope.jsonl"))).toEqual([]);
  });

  it("parses valid JSONL records", () => {
    writeReg([makeRecord({ run_id: "r1" }), makeRecord({ run_id: "r2" })]);
    const records = readRegistry(regFile);
    expect(records).toHaveLength(2);
    expect(records[0].run_id).toBe("r1");
    expect(records[1].run_id).toBe("r2");
  });

  it("deduplicates by run_id, keeping last", () => {
    writeReg([
      makeRecord({ run_id: "r1", status: "running" }),
      makeRecord({ run_id: "r1", status: "completed" }),
    ]);
    const records = readRegistry(regFile);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
  });

  it("skips malformed lines", () => {
    writeFileSync(regFile, "not json\n" + JSON.stringify(makeRecord({ run_id: "r1" })) + "\n", "utf-8");
    const records = readRegistry(regFile);
    expect(records).toHaveLength(1);
  });

  it("skips lines without run_id", () => {
    writeFileSync(regFile, JSON.stringify({ status: "running" }) + "\n", "utf-8");
    expect(readRegistry(regFile)).toHaveLength(0);
  });
});

describe("getRun", () => {
  it("finds a run by exact id", () => {
    writeReg([makeRecord({ run_id: "r1" }), makeRecord({ run_id: "r2" })]);
    const run = getRun(regFile, "r2");
    expect(run).toBeDefined();
    expect(run!.run_id).toBe("r2");
  });

  it("returns undefined for missing id", () => {
    writeReg([makeRecord({ run_id: "r1" })]);
    expect(getRun(regFile, "r99")).toBeUndefined();
  });
});

describe("activeRuns", () => {
  it("returns only running records", () => {
    writeReg([
      makeRecord({ run_id: "r1", status: "running" }),
      makeRecord({ run_id: "r2", status: "completed" }),
      makeRecord({ run_id: "r3", status: "running" }),
    ]);
    const active = activeRuns(regFile);
    expect(active).toHaveLength(2);
    expect(active.map((r) => r.run_id).sort()).toEqual(["r1", "r3"]);
  });
});

describe("recentRuns", () => {
  it("returns most recent by updated_at, limited", () => {
    writeReg([
      makeRecord({ run_id: "r1", updated_at: "2025-01-01T00:00:00Z" }),
      makeRecord({ run_id: "r2", updated_at: "2025-01-03T00:00:00Z" }),
      makeRecord({ run_id: "r3", updated_at: "2025-01-02T00:00:00Z" }),
    ]);
    const recent = recentRuns(regFile, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].run_id).toBe("r2");
    expect(recent[1].run_id).toBe("r3");
  });
});

describe("findRunByPrefix", () => {
  it("finds exact match", () => {
    writeReg([makeRecord({ run_id: "run-abc123" })]);
    const result = findRunByPrefix(regFile, "run-abc123");
    expect(result).toBeDefined();
    expect(!Array.isArray(result) && (result as any).run_id).toBe("run-abc123");
  });

  it("finds unique prefix match", () => {
    writeReg([makeRecord({ run_id: "run-abc123" }), makeRecord({ run_id: "run-xyz789" })]);
    const result = findRunByPrefix(regFile, "run-abc");
    expect(result).toBeDefined();
    expect(!Array.isArray(result) && (result as any).run_id).toBe("run-abc123");
  });

  it("returns array for ambiguous prefix", () => {
    writeReg([makeRecord({ run_id: "run-abc123" }), makeRecord({ run_id: "run-abc456" })]);
    const result = findRunByPrefix(regFile, "run-abc");
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
  });

  it("returns undefined for no match", () => {
    writeReg([makeRecord({ run_id: "run-abc123" })]);
    expect(findRunByPrefix(regFile, "zzz")).toBeUndefined();
  });

  it("prefers exact match over prefix match", () => {
    writeReg([makeRecord({ run_id: "run-abc" }), makeRecord({ run_id: "run-abc123" })]);
    const result = findRunByPrefix(regFile, "run-abc");
    expect(!Array.isArray(result) && (result as any).run_id).toBe("run-abc");
  });
});
