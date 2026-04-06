import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "../../src/worktree/create.js";
import { readMeta } from "../../src/worktree/meta.js";

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-create-"));
  execSync("git init && git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "t@t" },
  });
  return dir;
}

describe("createWorktree", () => {
  it("creates a valid git worktree and writes meta.json", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-test1",
    });

    // Worktree directory exists and is a git working tree
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(existsSync(join(result.worktreePath, ".git"))).toBe(true);

    // Branch name follows convention
    expect(result.branch).toBe("autoloop/run-test1");

    // Meta was written
    const meta = readMeta(result.metaDir);
    expect(meta).not.toBeNull();
    expect(meta!.run_id).toBe("run-test1");
    expect(meta!.branch).toBe("autoloop/run-test1");
    expect(meta!.status).toBe("running");
    expect(meta!.merge_strategy).toBe("squash");
    expect(meta!.base_branch).toBeTruthy();
  });

  it("uses custom branch prefix", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-custom",
      branchPrefix: "wt",
    });

    expect(result.branch).toBe("wt/run-custom");
  });

  it("fails fast on branch collision", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    // Create first worktree
    createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-dup",
    });

    // Second attempt with same runId should fail due to branch collision
    expect(() =>
      createWorktree({
        mainProjectDir: repo,
        mainStateDir: stateDir,
        runId: "run-dup",
      }),
    ).toThrow(/already exists/);
  });

  it("uses custom merge strategy", () => {
    const repo = makeGitRepo();
    const stateDir = join(repo, ".autoloop");

    const result = createWorktree({
      mainProjectDir: repo,
      mainStateDir: stateDir,
      runId: "run-merge",
      mergeStrategy: "rebase",
    });

    const meta = readMeta(result.metaDir);
    expect(meta!.merge_strategy).toBe("rebase");
  });
});
