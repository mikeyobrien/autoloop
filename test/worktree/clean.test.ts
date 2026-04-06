import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "../../src/worktree/create.js";
import { updateStatus } from "../../src/worktree/meta.js";
import { cleanWorktrees } from "../../src/worktree/clean.js";

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
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-clean1",
    });

    updateStatus(wt.metaDir, "merged");

    const result = cleanWorktrees({
      mainProjectDir: repo,
      mainStateDir: stateDir,
    });

    expect(result.removed).toContain("run-clean1");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("skips running worktrees without --force", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-running",
    });

    const result = cleanWorktrees({
      mainProjectDir: repo,
      mainStateDir: stateDir,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toContain("run-running");
  });

  it("removes running worktrees with --force", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const wt = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-force",
    });

    const result = cleanWorktrees({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-force",
      force: true,
    });

    expect(result.removed).toContain("run-force");
    expect(existsSync(wt.worktreePath)).toBe(false);
  });

  it("cleans a specific run by ID", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-keep",
    });

    const wt2 = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-remove",
    });
    updateStatus(wt2.metaDir, "failed");

    const result = cleanWorktrees({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-remove",
    });

    expect(result.removed).toContain("run-remove");
    expect(result.removed).not.toContain("run-keep");
  });

  it("returns empty when no worktrees dir exists", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = cleanWorktrees({
      mainProjectDir: repo,
      mainStateDir: stateDir,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
