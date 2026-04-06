import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorktreeMeta } from "../../src/worktree/meta.js";
import {
  metaDirForRun,
  readMeta,
  updateStatus,
  writeMeta,
} from "../../src/worktree/meta.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "autoloop-ts-wt-meta-"));
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

describe("metaDirForRun", () => {
  it("returns path under worktrees/<runId>", () => {
    expect(metaDirForRun("/tmp/.autoloop", "run-abc")).toBe(
      "/tmp/.autoloop/worktrees/run-abc",
    );
  });
});

describe("writeMeta / readMeta round-trip", () => {
  it("writes and reads back identical meta", () => {
    const dir = makeTempDir();
    const meta = sampleMeta();
    writeMeta(dir, meta);
    const read = readMeta(dir);
    expect(read).toEqual(meta);
  });

  it("creates the metaDir if it does not exist", () => {
    const base = makeTempDir();
    const metaDir = join(base, "nested", "deep");
    writeMeta(metaDir, sampleMeta());
    expect(existsSync(join(metaDir, "meta.json"))).toBe(true);
  });

  it("readMeta returns null when no file exists", () => {
    const dir = makeTempDir();
    expect(readMeta(dir)).toBeNull();
  });

  it("atomic write leaves no .tmp file", () => {
    const dir = makeTempDir();
    writeMeta(dir, sampleMeta());
    expect(existsSync(join(dir, "meta.json.tmp"))).toBe(false);
    expect(existsSync(join(dir, "meta.json"))).toBe(true);
  });
});

describe("updateStatus", () => {
  it("updates status field", () => {
    const dir = makeTempDir();
    writeMeta(dir, sampleMeta());
    updateStatus(dir, "completed");
    const updated = readMeta(dir)!;
    expect(updated.status).toBe("completed");
    expect(updated.merged_at).toBeNull();
  });

  it("sets merged_at when status is merged", () => {
    const dir = makeTempDir();
    writeMeta(dir, sampleMeta());
    updateStatus(dir, "merged");
    const updated = readMeta(dir)!;
    expect(updated.status).toBe("merged");
    expect(updated.merged_at).toBeTruthy();
  });

  it("sets removed_at when status is removed", () => {
    const dir = makeTempDir();
    writeMeta(dir, sampleMeta());
    updateStatus(dir, "removed");
    const updated = readMeta(dir)!;
    expect(updated.status).toBe("removed");
    expect(updated.removed_at).toBeTruthy();
  });

  it("throws when no meta exists", () => {
    const dir = makeTempDir();
    expect(() => updateStatus(dir, "completed")).toThrow("no worktree meta");
  });
});
