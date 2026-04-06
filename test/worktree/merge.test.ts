import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "../../src/worktree/create.js";
import { readMeta, updateStatus } from "../../src/worktree/meta.js";
import { mergeWorktree } from "../../src/worktree/merge.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-merge-"));
  execSync("git init && git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: GIT_ENV,
  });
  return dir;
}

function addFileAndCommit(dir: string, name: string, content: string, message: string): void {
  writeFileSync(join(dir, name), content);
  execSync(`git add ${name} && git commit -m '${message}'`, {
    cwd: dir,
    stdio: "pipe",
    env: GIT_ENV,
  });
}

describe("mergeWorktree", () => {
  it("squash-merges a completed worktree", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-merge1",
    });

    // Add a file in the worktree
    addFileAndCommit(wt.worktreePath, "feature.txt", "hello", "add feature");

    // Mark worktree as completed
    updateStatus(wt.metaDir, "completed");

    const result = mergeWorktree({
      mainProjectDir: repo,
      metaDir: wt.metaDir,
    });

    expect(result.success).toBe(true);

    // Meta should be "merged"
    const meta = readMeta(wt.metaDir);
    expect(meta!.status).toBe("merged");
    expect(meta!.merged_at).toBeTruthy();
  });

  it("merge strategy works", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-merge2",
      mergeStrategy: "merge",
    });

    addFileAndCommit(wt.worktreePath, "feature2.txt", "world", "add feature2");
    updateStatus(wt.metaDir, "completed");

    const result = mergeWorktree({
      mainProjectDir: repo,
      metaDir: wt.metaDir,
      strategy: "merge",
    });

    expect(result.success).toBe(true);
    expect(readMeta(wt.metaDir)!.status).toBe("merged");
  });

  it("rejects merging a running worktree", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-running",
    });

    expect(() =>
      mergeWorktree({ mainProjectDir: repo, metaDir: wt.metaDir }),
    ).toThrow(/still running/);
  });

  it("rejects merging an already-merged worktree", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-alrmerged",
    });

    addFileAndCommit(wt.worktreePath, "f.txt", "x", "add f");
    updateStatus(wt.metaDir, "completed");
    mergeWorktree({ mainProjectDir: repo, metaDir: wt.metaDir });

    expect(() =>
      mergeWorktree({ mainProjectDir: repo, metaDir: wt.metaDir }),
    ).toThrow(/already merged/);
  });

  it("detects conflicts and aborts", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    // Add a file on main
    addFileAndCommit(repo, "shared.txt", "main content", "add shared on main");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-conflict",
    });

    // Modify the same file differently in the worktree
    addFileAndCommit(wt.worktreePath, "shared.txt", "worktree content", "edit shared in wt");

    // Modify on main to create conflict
    addFileAndCommit(repo, "shared.txt", "different main content", "edit shared on main");

    updateStatus(wt.metaDir, "completed");

    // Checkout back to base to set up for merge
    const result = mergeWorktree({
      mainProjectDir: repo,
      metaDir: wt.metaDir,
    });

    expect(result.success).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
    expect(result.recoveryHint).toBeTruthy();

    // Meta should still be "completed" (not merged)
    const meta = readMeta(wt.metaDir);
    expect(meta!.status).toBe("completed");
  });
});
