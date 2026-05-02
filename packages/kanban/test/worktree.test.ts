import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyWorktreeIncludes,
  createTaskWorktree,
  isWorktreeDirty,
  listOrphanWorktrees,
  removeTaskWorktree,
  WORKTREE_INCLUDE_FILE,
} from "../src/worktree.js";

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-kanban-wt-"));
  execSync("git init && git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return dir;
}

describe("createTaskWorktree", () => {
  it("creates a worktree on branch autoloop/task-<id>", () => {
    const repo = makeGitRepo();
    const wt = join(
      repo,
      "..",
      `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    const result = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "abc",
    });
    expect(result.branch).toBe("autoloop/task-abc");
    expect(existsSync(result.worktreeDir)).toBe(true);
    expect(existsSync(join(result.worktreeDir, ".git"))).toBe(true);
    // Confirm git itself sees the branch.
    const branches = execSync("git branch --list autoloop/task-abc", {
      cwd: repo,
      encoding: "utf-8",
    });
    expect(branches).toContain("autoloop/task-abc");
  });

  it("throws when worktreeDir already exists", () => {
    const repo = makeGitRepo();
    const wt = join(repo, "..", `wt-existing-${Date.now()}`);
    execSync(`mkdir -p "${wt}"`, { stdio: "pipe" });
    expect(() =>
      createTaskWorktree({
        repoRoot: repo,
        worktreeDir: wt,
        taskId: "already",
      }),
    ).toThrow(/already exists/);
  });
});

describe("isWorktreeDirty", () => {
  it("returns false on a clean worktree, true after a write", () => {
    const repo = makeGitRepo();
    const wt = join(repo, "..", `wt-dirty-${Date.now()}`);
    createTaskWorktree({ repoRoot: repo, worktreeDir: wt, taskId: "dirty" });
    expect(isWorktreeDirty(wt)).toBe(false);
    writeFileSync(join(wt, "new.txt"), "hi");
    expect(isWorktreeDirty(wt)).toBe(true);
  });
});

describe("removeTaskWorktree", () => {
  it("refuses to remove a dirty worktree without force, succeeds with force", () => {
    const repo = makeGitRepo();
    const wt = join(repo, "..", `wt-remove-${Date.now()}`);
    createTaskWorktree({ repoRoot: repo, worktreeDir: wt, taskId: "rm" });
    writeFileSync(join(wt, "dirty.txt"), "dirty");

    expect(() =>
      removeTaskWorktree({ repoRoot: repo, worktreeDir: wt }),
    ).toThrow(/uncommitted changes/);
    expect(existsSync(wt)).toBe(true);

    removeTaskWorktree({ repoRoot: repo, worktreeDir: wt, force: true });
    expect(existsSync(wt)).toBe(false);
  });
});

describe("copyWorktreeIncludes", () => {
  it("copies listed files and rejects absolute-path entries", () => {
    const repo = makeGitRepo();
    writeFileSync(join(repo, "payload.txt"), "hello");

    const destA = mkdtempSync(join(tmpdir(), "autoloop-kanban-copy-ok-"));
    writeFileSync(join(repo, WORKTREE_INCLUDE_FILE), "payload.txt\n");
    const ok = copyWorktreeIncludes(repo, destA);
    expect(ok.copied).toEqual(["payload.txt"]);
    expect(existsSync(join(destA, "payload.txt"))).toBe(true);

    const destB = mkdtempSync(join(tmpdir(), "autoloop-kanban-copy-abs-"));
    writeFileSync(join(repo, WORKTREE_INCLUDE_FILE), "/etc/hostname\n");
    expect(() => copyWorktreeIncludes(repo, destB)).toThrow(
      /\.autoloop-worktreeinclude/,
    );
  });
});

describe("listOrphanWorktrees", () => {
  it("returns an empty list for a fresh repo", () => {
    const repo = makeGitRepo();
    expect(listOrphanWorktrees(repo)).toEqual([]);
  });
});
