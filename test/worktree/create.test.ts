import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorktree, resolveGitRoot } from "../../src/worktree/create.js";
import { readMeta } from "../../src/worktree/meta.js";

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-create-"));
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

describe("createWorktree", () => {
  it("creates a valid git worktree and writes meta.json", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainStateDir: stateDir,
      runId: "run-test1",
      workDir: repo,
    });

    // Worktree directory exists and is a git working tree
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(existsSync(join(result.worktreePath, ".git"))).toBe(true);

    // Branch name follows convention
    expect(result.branch).toBe("autoloop/run-test1");

    // Meta was written
    const meta = readMeta(result.metaDir);
    expect(meta).not.toBeNull();
    expect(meta?.run_id).toBe("run-test1");
    expect(meta?.branch).toBe("autoloop/run-test1");
    expect(meta?.status).toBe("running");
    expect(meta?.merge_strategy).toBe("squash");
    expect(meta?.base_branch).toBeTruthy();
  });

  it("uses custom branch prefix", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainStateDir: stateDir,
      runId: "run-custom",
      branchPrefix: "wt",
      workDir: repo,
    });

    expect(result.branch).toBe("wt/run-custom");
  });

  it("fails fast on branch collision", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    // Create first worktree
    createWorktree({
      mainStateDir: stateDir,
      runId: "run-dup",
      workDir: repo,
    });

    // Second attempt with same runId should fail due to branch collision
    expect(() =>
      createWorktree({
        mainStateDir: stateDir,
        runId: "run-dup",
        workDir: repo,
      }),
    ).toThrow(/already exists/);
  });

  it("uses custom merge strategy", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainStateDir: stateDir,
      runId: "run-merge",
      mergeStrategy: "rebase",
      workDir: repo,
    });

    const meta = readMeta(result.metaDir);
    expect(meta?.merge_strategy).toBe("rebase");
  });
});

describe("resolveGitRoot", () => {
  it("resolves git root from within a repo", () => {
    const repo = makeGitRepo();
    const subDir = join(repo, "subdir");
    execSync("mkdir -p subdir", { cwd: repo, stdio: "pipe" });

    const resolved = resolveGitRoot(subDir);
    expect(resolved).toBe(realpathSync(repo));
  });

  it("returns the same canonical path regardless of subdirectory depth", () => {
    const repo = makeGitRepo();
    execSync("mkdir -p a/b/c", { cwd: repo, stdio: "pipe" });

    expect(resolveGitRoot(repo)).toBe(resolveGitRoot(join(repo, "a/b/c")));
  });

  it("throws when called outside a git repo", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "autoloop-ts-non-git-"));

    expect(() => resolveGitRoot(nonGitDir)).toThrow(
      /requires the current directory to be inside a git repository/,
    );
  });
});
