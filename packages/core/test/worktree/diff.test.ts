import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorktree } from "../../src/worktree/create.js";
import { diffWorktree } from "../../src/worktree/diff.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-diff-"));
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

describe("diffWorktree", () => {
  it("reports added files with insertion counts", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-diff1",
      workDir: repo,
    });

    addFileAndCommit(
      wt.worktreePath,
      "feature.txt",
      "line one\nline two\n",
      "add feature",
    );

    const result = diffWorktree({ metaDir: wt.metaDir, workDir: repo });

    expect(result.branch).toBe("autoloop/run-diff1");
    expect(result.base).toBeTruthy();
    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBe(2);
    expect(result.deletions).toBe(0);
    expect(result.files).toEqual([{ path: "feature.txt", status: "added" }]);
    expect(result.patch).toBeUndefined();
  });

  it("reports modifications and deletions with counts", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    addFileAndCommit(repo, "keep.txt", "old line\n", "add keep");
    addFileAndCommit(repo, "gone.txt", "bye\n", "add gone");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-diff2",
      workDir: repo,
    });

    writeFileSync(join(wt.worktreePath, "keep.txt"), "new line\n");
    execSync("git rm -q gone.txt && git add keep.txt && git commit -m edit", {
      cwd: wt.worktreePath,
      stdio: "pipe",
      env: GIT_ENV,
    });

    const result = diffWorktree({ metaDir: wt.metaDir, workDir: repo });

    expect(result.filesChanged).toBe(2);
    expect(result.insertions).toBe(1);
    expect(result.deletions).toBe(2);
    expect(result.files).toContainEqual({
      path: "keep.txt",
      status: "modified",
    });
    expect(result.files).toContainEqual({
      path: "gone.txt",
      status: "deleted",
    });
  });

  it("includes the full patch when requested", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-diff3",
      workDir: repo,
    });

    addFileAndCommit(wt.worktreePath, "patched.txt", "hello patch\n", "add");

    const result = diffWorktree({
      metaDir: wt.metaDir,
      workDir: repo,
      patch: true,
    });

    expect(result.patch).toBeDefined();
    expect(result.patch).toContain("diff --git a/patched.txt b/patched.txt");
    expect(result.patch).toContain("+hello patch");
  });

  it("does not include base-only commits in the diff", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-diff4",
      workDir: repo,
    });

    addFileAndCommit(wt.worktreePath, "wt.txt", "in worktree\n", "wt change");
    // Advance the base branch after the worktree forked
    addFileAndCommit(repo, "base.txt", "on base\n", "base change");

    const result = diffWorktree({ metaDir: wt.metaDir, workDir: repo });

    expect(result.files).toEqual([{ path: "wt.txt", status: "added" }]);
  });

  it("throws a clear error when meta is missing", () => {
    const repo = makeGitRepo();
    const metaDir = join(repo, ".autoloop", "worktrees", "run-nope");

    expect(() => diffWorktree({ metaDir, workDir: repo })).toThrow(
      /no worktree meta found/,
    );
  });

  it("falls back to the project dir when the worktree dir was removed", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-diff5",
      workDir: repo,
    });

    addFileAndCommit(wt.worktreePath, "still.txt", "kept in refs\n", "add");
    rmSync(wt.worktreePath, { recursive: true, force: true });

    // Branch refs still live in the main repo, so the diff still works.
    const result = diffWorktree({ metaDir: wt.metaDir, workDir: repo });
    expect(result.files).toEqual([{ path: "still.txt", status: "added" }]);
  });
});
