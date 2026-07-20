import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeChainStepStateLayout } from "../../src/chain-state.js";
import {
  discoverChainRegistries,
  mergedActiveRuns,
  mergedFindRunByPrefix,
  readMergedRegistry,
} from "../../src/registry/discover.js";

function makeRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
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

function writeJsonl(path: string, records: Record<string, unknown>[]) {
  writeFileSync(
    path,
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf-8",
  );
}

let stateDir: string;

beforeEach(() => {
  stateDir = join(
    tmpdir(),
    `discover-test-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("discoverChainRegistries", () => {
  it("returns empty when no chains exist", () => {
    expect(discoverChainRegistries(stateDir)).toEqual([]);
  });

  it("returns empty when an unreadable chains entry is not a directory", () => {
    writeFileSync(join(stateDir, "chains"), "not a directory", "utf-8");
    expect(discoverChainRegistries(stateDir)).toEqual([]);
  });

  it("falls back to the default child root when metadata is malformed", () => {
    const stepDir = join(stateDir, "chains", "chain-legacy", "step-1");
    const childStateDir = join(stepDir, ".autoloop");
    mkdirSync(childStateDir, { recursive: true });
    writeFileSync(join(stepDir, "state-layout.json"), "{broken", "utf-8");
    writeJsonl(join(childStateDir, "registry.jsonl"), [
      makeRecord({ run_id: "legacy-default" }),
    ]);

    expect(
      discoverChainRegistries(stateDir, join(".ralph", "autoloop")),
    ).toEqual([join(childStateDir, "registry.jsonl")]);
  });

  it("supports an explicitly recorded absolute child state root", () => {
    const stepDir = join(stateDir, "chains", "chain-absolute", "step-1");
    const childStateDir = join(stateDir, "absolute-child-state");
    mkdirSync(childStateDir, { recursive: true });
    writeChainStepStateLayout(stepDir, childStateDir);
    writeJsonl(join(childStateDir, "registry.jsonl"), [
      makeRecord({ run_id: "absolute-child" }),
    ]);

    expect(discoverChainRegistries(stateDir)).toEqual([
      join(childStateDir, "registry.jsonl"),
    ]);
  });

  it("discovers chain step registries", () => {
    const chainReg = join(
      stateDir,
      "chains",
      "chain-abc",
      "step-1",
      ".autoloop",
    );
    mkdirSync(chainReg, { recursive: true });
    writeJsonl(join(chainReg, "registry.jsonl"), [
      makeRecord({ run_id: "chain-run-1" }),
    ]);
    const found = discoverChainRegistries(stateDir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("chain-abc");
  });

  it("discovers worktree-isolated registries", () => {
    const wtReg = join(
      stateDir,
      "chains",
      "chain-xyz",
      "step-0",
      ".autoloop",
      "worktrees",
      "run-wt1",
      "tree",
      ".autoloop",
    );
    mkdirSync(wtReg, { recursive: true });
    writeJsonl(join(wtReg, "registry.jsonl"), [
      makeRecord({ run_id: "wt-run-1" }),
    ]);
    const found = discoverChainRegistries(stateDir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("worktrees");
  });

  it("uses recorded default child layout when the parent root is custom", () => {
    const parentStateDirRel = join(".ralph", "autoloop");
    const stepDir = join(stateDir, "chains", "chain-mixed", "step-1");
    const direct = join(stepDir, ".autoloop");
    const worktree = join(
      direct,
      "worktrees",
      "run-default",
      "tree",
      ".autoloop",
    );
    mkdirSync(worktree, { recursive: true });
    writeChainStepStateLayout(stepDir, ".autoloop");
    writeJsonl(join(direct, "registry.jsonl"), [
      makeRecord({ run_id: "mixed-direct" }),
    ]);
    writeJsonl(join(worktree, "registry.jsonl"), [
      makeRecord({ run_id: "mixed-worktree" }),
    ]);

    expect(discoverChainRegistries(stateDir, parentStateDirRel)).toEqual([
      join(direct, "registry.jsonl"),
      join(worktree, "registry.jsonl"),
    ]);
  });

  it("uses a recorded custom child root independently of the parent", () => {
    const childStateDirRel = join(".child", "state");
    const stepDir = join(stateDir, "chains", "chain-child-custom", "step-2");
    const childStateDir = join(stepDir, childStateDirRel);
    mkdirSync(childStateDir, { recursive: true });
    writeChainStepStateLayout(stepDir, childStateDirRel);
    writeJsonl(join(childStateDir, "registry.jsonl"), [
      makeRecord({ run_id: "custom-child" }),
    ]);

    expect(discoverChainRegistries(stateDir)).toEqual([
      join(childStateDir, "registry.jsonl"),
    ]);
  });

  it("discovers direct and worktree registries under a nested custom root", () => {
    const stateDirRel = join(".ralph", "autoloop");
    const stepDir = join(stateDir, "chains", "chain-custom", "step-1");
    const direct = join(stepDir, stateDirRel);
    const worktree = join(
      direct,
      "worktrees",
      "run-custom",
      "tree",
      stateDirRel,
    );
    mkdirSync(worktree, { recursive: true });
    writeJsonl(join(direct, "registry.jsonl"), [
      makeRecord({ run_id: "custom-direct" }),
    ]);
    writeJsonl(join(worktree, "registry.jsonl"), [
      makeRecord({ run_id: "custom-worktree" }),
    ]);

    const found = discoverChainRegistries(stateDir, stateDirRel);

    expect(found).toEqual([
      join(direct, "registry.jsonl"),
      join(worktree, "registry.jsonl"),
    ]);
    expect(
      readMergedRegistry(stateDir, stateDirRel).map((r) => r.run_id),
    ).toEqual(["custom-direct", "custom-worktree"]);
  });
});

describe("readMergedRegistry", () => {
  it("returns root registry when no chains exist", () => {
    writeJsonl(join(stateDir, "registry.jsonl"), [
      makeRecord({ run_id: "root-1", status: "running" }),
    ]);
    const merged = readMergedRegistry(stateDir);
    expect(merged).toHaveLength(1);
    expect(merged[0].run_id).toBe("root-1");
  });

  it("merges root and chain child registries", () => {
    writeJsonl(join(stateDir, "registry.jsonl"), [
      makeRecord({ run_id: "root-1" }),
    ]);
    const chainReg = join(
      stateDir,
      "chains",
      "chain-abc",
      "step-1",
      ".autoloop",
    );
    mkdirSync(chainReg, { recursive: true });
    writeJsonl(join(chainReg, "registry.jsonl"), [
      makeRecord({ run_id: "chain-child-1", status: "running" }),
    ]);
    const merged = readMergedRegistry(stateDir);
    expect(merged).toHaveLength(2);
    const ids = merged.map((r) => r.run_id).sort();
    expect(ids).toEqual(["chain-child-1", "root-1"]);
  });

  it("deduplicates by run_id with freshest updated_at winning", () => {
    writeJsonl(join(stateDir, "registry.jsonl"), [
      makeRecord({
        run_id: "dup-1",
        status: "running",
        updated_at: "2025-01-01T00:00:00Z",
      }),
    ]);
    const chainReg = join(
      stateDir,
      "chains",
      "chain-abc",
      "step-1",
      ".autoloop",
    );
    mkdirSync(chainReg, { recursive: true });
    writeJsonl(join(chainReg, "registry.jsonl"), [
      makeRecord({
        run_id: "dup-1",
        status: "completed",
        updated_at: "2025-01-02T00:00:00Z",
      }),
    ]);
    const merged = readMergedRegistry(stateDir);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("completed");
    expect(merged[0].updated_at).toBe("2025-01-02T00:00:00Z");
  });

  it("discovers active chain child run", () => {
    // Root has no runs
    writeJsonl(join(stateDir, "registry.jsonl"), []);
    // Chain step has an active child
    const chainReg = join(
      stateDir,
      "chains",
      "chain-active",
      "step-0",
      ".autoloop",
    );
    mkdirSync(chainReg, { recursive: true });
    writeJsonl(join(chainReg, "registry.jsonl"), [
      makeRecord({
        run_id: "active-child",
        status: "running",
        updated_at: "2025-06-01T00:00:00Z",
      }),
    ]);
    const active = mergedActiveRuns(stateDir);
    expect(active).toHaveLength(1);
    expect(active[0].run_id).toBe("active-child");
  });

  it("discovers worktree-isolated child run", () => {
    writeJsonl(join(stateDir, "registry.jsonl"), [
      makeRecord({ run_id: "root-run" }),
    ]);
    const wtReg = join(
      stateDir,
      "chains",
      "chain-wt",
      "step-1",
      ".autoloop",
      "worktrees",
      "run-isolated",
      "tree",
      ".autoloop",
    );
    mkdirSync(wtReg, { recursive: true });
    writeJsonl(join(wtReg, "registry.jsonl"), [
      makeRecord({
        run_id: "isolated-child",
        status: "running",
        isolation_mode: "worktree",
      }),
    ]);
    const merged = readMergedRegistry(stateDir);
    expect(merged).toHaveLength(2);
    const found = merged.find((r) => r.run_id === "isolated-child");
    expect(found).toBeDefined();
    expect(found?.isolation_mode).toBe("worktree");
  });
});

describe("mergedFindRunByPrefix", () => {
  it("finds a run from a chain child registry by prefix", () => {
    writeJsonl(join(stateDir, "registry.jsonl"), []);
    const chainReg = join(
      stateDir,
      "chains",
      "chain-find",
      "step-0",
      ".autoloop",
    );
    mkdirSync(chainReg, { recursive: true });
    writeJsonl(join(chainReg, "registry.jsonl"), [
      makeRecord({ run_id: "chain-find-run-xyz" }),
    ]);
    const result = mergedFindRunByPrefix(stateDir, "chain-find-run");
    expect(result).toBeDefined();
    expect(
      !Array.isArray(result) &&
        (result as Record<string, unknown> | undefined)?.run_id,
    ).toBe("chain-find-run-xyz");
  });
});
