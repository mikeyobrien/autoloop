import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorktreeMetas } from "../../src/worktree/list.js";
import type { WorktreeMeta } from "../../src/worktree/meta.js";
import { writeMeta } from "../../src/worktree/meta.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "autoloop-ts-wt-list-"));
}

function sampleMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    run_id: "run-abc",
    branch: "autoloop/run-abc",
    worktree_path: "/tmp/tree",
    base_branch: "main",
    status: "running",
    merge_strategy: "squash",
    created_at: "2026-01-01T00:00:00.000Z",
    merged_at: null,
    removed_at: null,
    ...overrides,
  };
}

describe("listWorktreeMetas", () => {
  it("returns empty array when worktrees dir does not exist", () => {
    const stateDir = makeTempDir();
    expect(listWorktreeMetas(stateDir)).toEqual([]);
  });

  it("returns empty array when worktrees dir is empty", () => {
    const stateDir = makeTempDir();
    mkdirSync(join(stateDir, "worktrees"));
    expect(listWorktreeMetas(stateDir)).toEqual([]);
  });

  it("lists worktrees with correct fields", () => {
    const stateDir = makeTempDir();
    const metaDir = join(stateDir, "worktrees", "run-abc");
    // Point worktree_path at metaDir itself so it exists
    writeMeta(metaDir, sampleMeta({ worktree_path: metaDir }));

    const entries = listWorktreeMetas(stateDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].run_id).toBe("run-abc");
    expect(entries[0].orphan).toBe(false);
  });

  it("flags orphan when worktree path does not exist", () => {
    const stateDir = makeTempDir();
    const metaDir = join(stateDir, "worktrees", "run-abc");
    writeMeta(metaDir, sampleMeta({ worktree_path: "/nonexistent/path" }));

    const entries = listWorktreeMetas(stateDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].orphan).toBe(true);
  });

  it("does not flag removed worktrees as orphan even if path is missing", () => {
    const stateDir = makeTempDir();
    const metaDir = join(stateDir, "worktrees", "run-abc");
    writeMeta(
      metaDir,
      sampleMeta({
        status: "removed",
        worktree_path: "/nonexistent/path",
      }),
    );

    const entries = listWorktreeMetas(stateDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].orphan).toBe(false);
  });

  it("handles multiple entries with mixed orphan status", () => {
    const stateDir = makeTempDir();

    const metaDirA = join(stateDir, "worktrees", "run-a");
    writeMeta(
      metaDirA,
      sampleMeta({
        run_id: "run-a",
        worktree_path: metaDirA, // exists
      }),
    );

    const metaDirB = join(stateDir, "worktrees", "run-b");
    writeMeta(
      metaDirB,
      sampleMeta({
        run_id: "run-b",
        worktree_path: "/gone", // orphan
      }),
    );

    const entries = listWorktreeMetas(stateDir);
    expect(entries).toHaveLength(2);

    const a = entries.find((e) => e.run_id === "run-a")!;
    const b = entries.find((e) => e.run_id === "run-b")!;
    expect(a.orphan).toBe(false);
    expect(b.orphan).toBe(true);
  });
});
