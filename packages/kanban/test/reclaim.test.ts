import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { reclaimWorktreeForTask } from "../src/reclaim.js";
import { TaskStore } from "../src/task_store.js";
import { createTaskWorktree, reclaimTaskWorktree } from "../src/worktree.js";

/** Make a git repo with a bare "origin" remote, HEAD pushed. Used so
 *  `hasUnpushedCommits(worktree)` returns false on a fresh clean worktree. */
function makeGitRepo(): string {
  const parent = mkdtempSync(join(tmpdir(), "autoloop-kanban-reclaim-"));
  const dir = join(parent, "repo");
  const remote = join(parent, "origin.git");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execSync(`git init -b main "${dir}"`, { stdio: "pipe" });
  execSync(`git init --bare -b main "${remote}"`, { stdio: "pipe" });
  execSync("git commit --allow-empty -m init", {
    cwd: dir,
    stdio: "pipe",
    env: gitEnv,
  });
  execSync(`git remote add origin "${remote}"`, { cwd: dir, stdio: "pipe" });
  execSync("git push -u origin main", {
    cwd: dir,
    stdio: "pipe",
    env: gitEnv,
  });
  return dir;
}

function freshStore(): TaskStore {
  const dir = mkdtempSync(join(tmpdir(), "kanban-reclaim-store-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
  });
}

describe("reclaimTaskWorktree", () => {
  it("removes a clean worktree and deletes its branch", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-clean-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { branch } = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "clean",
    });
    const r = reclaimTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      branch,
    });
    expect(r).toEqual({ outcome: "removed" });
    expect(existsSync(wt)).toBe(false);
    const branches = execSync(`git branch --list ${branch}`, {
      cwd: repo,
      encoding: "utf-8",
    });
    expect(branches).toBe("");
  });

  it("preserves a worktree with uncommitted changes", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-dirty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { branch } = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "dirty",
    });
    writeFileSync(join(wt, "scratch.txt"), "pending work");
    const r = reclaimTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      branch,
    });
    expect(r).toEqual({ outcome: "preserved", reason: "dirty" });
    expect(existsSync(wt)).toBe(true);
  });

  it("preserves a worktree with unpushed commits (no remote)", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-unpushed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { branch } = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "unpushed",
    });
    // Commit work inside the worktree so it has content beyond HEAD.
    writeFileSync(join(wt, "work.txt"), "done");
    execSync("git add . && git commit -m work", {
      cwd: wt,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    const r = reclaimTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      branch,
    });
    expect(r).toEqual({ outcome: "preserved", reason: "unpushed" });
    expect(existsSync(wt)).toBe(true);
  });

  it("returns missing when the worktree dir does not exist", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-missing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const r = reclaimTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      branch: "autoloop/task-missing",
    });
    expect(r).toEqual({ outcome: "missing" });
  });
});

describe("reclaimWorktreeForTask", () => {
  it("removes a clean worktree and clears the store block", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { branch } = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "orch",
    });
    const store = freshStore();
    const task = store.add({ title: "orch task" });
    store.setWorktree(task.id, {
      path: wt,
      branch,
      base_ref: "HEAD",
      created: new Date().toISOString(),
    });
    const refreshed = store.get(task.id);
    if (!refreshed) throw new Error("task not found after setWorktree");
    const counts = reclaimWorktreeForTask(store, refreshed);
    expect(counts).toEqual({ removed: 1, preserved: 0, errors: 0 });
    expect(store.get(task.id)?.worktree).toBeUndefined();
    expect(existsSync(wt)).toBe(false);
  });

  it("preserves a dirty worktree and stamps preserved_reason", () => {
    const repo = makeGitRepo();
    const wt = join(
      dirname(repo),
      `wt-preserve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { branch } = createTaskWorktree({
      repoRoot: repo,
      worktreeDir: wt,
      taskId: "preserve",
    });
    writeFileSync(join(wt, "pending.txt"), "in-flight");
    const store = freshStore();
    const task = store.add({ title: "preserve task" });
    store.setWorktree(task.id, {
      path: wt,
      branch,
      base_ref: "HEAD",
      created: new Date().toISOString(),
    });
    const refreshed = store.get(task.id);
    if (!refreshed) throw new Error("task not found after setWorktree");
    const counts = reclaimWorktreeForTask(store, refreshed);
    expect(counts).toEqual({ removed: 0, preserved: 1, errors: 0 });
    const after = store.get(task.id);
    expect(after?.worktree?.preserved_reason).toBe("dirty");
    expect(after?.worktree?.path).toBe(wt);
    expect(existsSync(wt)).toBe(true);
  });

  it("returns zeros when the task has no worktree", () => {
    const store = freshStore();
    const task = store.add({ title: "no-wt" });
    const counts = reclaimWorktreeForTask(store, task);
    expect(counts).toEqual({ removed: 0, preserved: 0, errors: 0 });
  });
});
