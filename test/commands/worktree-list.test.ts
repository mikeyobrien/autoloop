import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMeta } from "../../src/worktree/meta.js";
import type { WorktreeMeta } from "../../src/worktree/meta.js";
import { dispatchWorktree } from "../../src/commands/worktree.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "autoloop-ts-wt-cmd-"));
}

function sampleMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    run_id: "run-abc12345",
    branch: "autoloop/run-abc12345",
    worktree_path: "/tmp/tree",
    base_branch: "main",
    status: "completed",
    merge_strategy: "squash",
    created_at: "2026-01-15T10:30:00.000Z",
    merged_at: null,
    removed_at: null,
    ...overrides,
  };
}

describe("worktree list output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["MINILOOPS_PROJECT_DIR"];
  });

  it("renders BASE column in header and data rows", () => {
    const projectDir = makeTempDir();
    const stateDir = join(projectDir, ".autoloop");
    const metaDir = join(stateDir, "worktrees", "run-abc12345");
    writeMeta(metaDir, sampleMeta({ worktree_path: metaDir }));

    process.env["MINILOOPS_PROJECT_DIR"] = projectDir;

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    dispatchWorktree(["list"]);

    // Header should contain BASE column
    const header = lines[0];
    expect(header).toContain("BASE");
    expect(header).toContain("RUN ID");
    expect(header).toContain("STRATEGY");

    // BASE should appear between BRANCH and STRATEGY in header
    const baseIdx = header.indexOf("BASE");
    const branchIdx = header.indexOf("BRANCH");
    const strategyIdx = header.indexOf("STRATEGY");
    expect(baseIdx).toBeGreaterThan(branchIdx);
    expect(baseIdx).toBeLessThan(strategyIdx);

    // Data row should contain the base_branch value
    const dataRow = lines[1];
    expect(dataRow).toContain("main");
    expect(dataRow).toContain("run-abc12345");
    expect(dataRow).toContain("squash");
  });

  it("renders different base branches correctly", () => {
    const projectDir = makeTempDir();
    const stateDir = join(projectDir, ".autoloop");

    const metaDirA = join(stateDir, "worktrees", "run-aaa");
    writeMeta(metaDirA, sampleMeta({
      run_id: "run-aaa",
      branch: "autoloop/run-aaa",
      base_branch: "develop",
      worktree_path: metaDirA,
    }));

    const metaDirB = join(stateDir, "worktrees", "run-bbb");
    writeMeta(metaDirB, sampleMeta({
      run_id: "run-bbb",
      branch: "autoloop/run-bbb",
      base_branch: "release/v2",
      worktree_path: "/nonexistent",
    }));

    process.env["MINILOOPS_PROJECT_DIR"] = projectDir;

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });

    dispatchWorktree([]);

    // Should have header + 2 data rows
    expect(lines).toHaveLength(3);
    expect(lines.some(l => l.includes("develop"))).toBe(true);
    expect(lines.some(l => l.includes("release/v2"))).toBe(true);
  });
});
