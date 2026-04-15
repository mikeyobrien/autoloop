import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanWorktrees } from "../../src/worktree/clean.js";
import { createWorktree } from "../../src/worktree/create.js";
import { updateStatus } from "../../src/worktree/meta.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-clean-"));
  execSync("git init && git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: GIT_ENV,
  });
  return dir;
}

describe("cleanWorktrees", () => {
  it("removes merged worktrees", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-clean1",
      workDir: repo,
    });

    updateStatus(wt.metaDir, "merged");

    const result = cleanWorktrees({
      mainStateDir: stateDir,
      workDir: repo,
    });

    expect(result.removed).toContain("run-clean1");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("skips running worktrees without --force", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    createWorktree({
      mainStateDir: stateDir,
      runId: "run-running",
      workDir: repo,
    });

    const result = cleanWorktrees({
      mainStateDir: stateDir,
      workDir: repo,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toContain("run-running");
  });

  it("removes running worktrees with --force", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainStateDir: stateDir,
      runId: "run-force",
      workDir: repo,
    });

    const result = cleanWorktrees({
      mainStateDir: stateDir,
      runId: "run-force",
      force: true,
      workDir: repo,
    });

    expect(result.removed).toContain("run-force");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("cleans a specific run by ID", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    createWorktree({
      mainStateDir: stateDir,
      runId: "run-keep",
      workDir: repo,
    });

    const wt2 = createWorktree({
      mainStateDir: stateDir,
      runId: "run-remove",
      workDir: repo,
    });
    updateStatus(wt2.metaDir, "failed");

    const result = cleanWorktrees({
      mainStateDir: stateDir,
      runId: "run-remove",
      workDir: repo,
    });

    expect(result.removed).toContain("run-remove");
    expect(result.removed).not.toContain("run-keep");
  });

  it("returns empty when no worktrees dir exists", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = cleanWorktrees({
      mainStateDir: stateDir,
      workDir: repo,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
