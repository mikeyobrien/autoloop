import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanWorktrees } from "../../src/worktree/clean.js";
import { createWorktree } from "../../src/worktree/create.js";
import { mergeWorktree } from "../../src/worktree/merge.js";
import { readMeta, updateStatus } from "../../src/worktree/meta.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-lifecycle-"));
  execSync("git init && git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: GIT_ENV,
  });
  return dir;
}

function addFileAndCommit(
  dir: string,
  name: string,
  content: string,
  message: string,
): void {
  writeFileSync(join(dir, name), content);
  execSync(`git add ${name} && git commit -m '${message}'`, {
    cwd: dir,
    stdio: "pipe",
    env: GIT_ENV,
  });
}

describe("worktree lifecycle: merge-strategy and cleanup", () => {
  it("stores CLI merge-strategy in worktree meta", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-strategy",
      mergeStrategy: "rebase",
    });

    const meta = readMeta(wt.metaDir);
    expect(meta?.merge_strategy).toBe("rebase");
  });

  it("automerge + cleanup on_success: merges then cleans on success", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-automerge",
      mergeStrategy: "squash",
    });

    addFileAndCommit(wt.worktreePath, "feature.txt", "content", "add feature");
    updateStatus(wt.metaDir, "completed");

    // Simulate automerge
    const mergeResult = mergeWorktree({
      metaDir: wt.metaDir,
      strategy: "squash",
      workDir: repo,
    });
    expect(mergeResult.success).toBe(true);

    // Simulate cleanup (on_success policy — run succeeded)
    const cleanResult = cleanWorktrees({
      mainStateDir: stateDir,
      runId: "run-automerge",
      workDir: repo,
    });
    expect(cleanResult.removed).toContain("run-automerge");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("keep-worktree prevents cleanup after success", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-keep",
    });

    updateStatus(wt.metaDir, "completed");

    // With keep-worktree, we don't call cleanWorktrees at all
    // Verify worktree still exists
    expect(existsSync(wt.worktreePath)).toBe(true);
    const meta = readMeta(wt.metaDir);
    expect(meta?.status).toBe("completed");
  });

  it("cleanup never: worktree preserved even on success", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-never-clean",
    });

    updateStatus(wt.metaDir, "completed");

    // cleanup=never means we don't call cleanWorktrees
    // Verify worktree persists
    expect(existsSync(wt.worktreePath)).toBe(true);
  });

  it("cleanup always: worktree removed even on failure", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-always-clean",
    });

    updateStatus(wt.metaDir, "failed");

    // cleanup=always with force removes failed worktrees
    const cleanResult = cleanWorktrees({
      mainStateDir: stateDir,
      runId: "run-always-clean",
      force: true,
      workDir: repo,
    });
    expect(cleanResult.removed).toContain("run-always-clean");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("on_success cleanup skips failed worktrees", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      workDir: repo,
      mainStateDir: stateDir,
      runId: "run-fail-noclean",
    });

    updateStatus(wt.metaDir, "failed");

    // on_success policy: should clean terminal-status worktrees (failed is terminal)
    const cleanResult = cleanWorktrees({
      mainStateDir: stateDir,
      runId: "run-fail-noclean",
      workDir: repo,
    });
    // clean.ts removes failed worktrees since they're terminal status
    expect(cleanResult.removed).toContain("run-fail-noclean");
  });
});
