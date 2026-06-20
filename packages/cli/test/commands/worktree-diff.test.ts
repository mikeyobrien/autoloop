import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree } from "@mobrienv/autoloop-core/worktree";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchWorktree } from "../../src/commands/worktree.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-wt-diff-cmd-"));
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

function setupRepoWithWorktree(runId: string): string {
  const repo = makeGitRepo();
  const wt = createWorktree({
    mainStateDir: join(repo, ".autoloop"),
    runId,
    workDir: repo,
  });
  addFileAndCommit(
    wt.worktreePath,
    "feature.txt",
    "alpha\nbeta\n",
    "add feature",
  );
  return repo;
}

function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  return lines;
}

describe("worktree diff command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AUTOLOOP_PROJECT_DIR;
    process.exitCode = undefined;
  });

  it("prints a summary with branch, base, and diffstat table", () => {
    const repo = setupRepoWithWorktree("run-cli-diff1");
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff", "run-cli-diff1"]);

    const out = lines.join("\n");
    expect(out).toContain("autoloop/run-cli-diff1");
    expect(out).toContain("Base:");
    expect(out).toContain("1 file(s), +2 -0");
    expect(out).toContain("STATUS");
    expect(out).toContain("PATH");
    expect(out).toMatch(/added\s+feature\.txt/);
    // No patch by default
    expect(out).not.toContain("diff --git");
  });

  it("appends the full patch with --patch", () => {
    const repo = setupRepoWithWorktree("run-cli-diff2");
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff", "run-cli-diff2", "--patch"]);

    const out = lines.join("\n");
    expect(out).toContain("diff --git a/feature.txt b/feature.txt");
    expect(out).toContain("+alpha");
    expect(out).toContain("+beta");
  });

  it("prints the structured result with --json", () => {
    const repo = setupRepoWithWorktree("run-cli-diff3");
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff", "run-cli-diff3", "--json"]);

    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.branch).toBe("autoloop/run-cli-diff3");
    expect(parsed.filesChanged).toBe(1);
    expect(parsed.insertions).toBe(2);
    expect(parsed.deletions).toBe(0);
    expect(parsed.files).toEqual([{ path: "feature.txt", status: "added" }]);
    expect(parsed.patch).toBeUndefined();
  });

  it("includes the patch in --json output when --patch is set", () => {
    const repo = setupRepoWithWorktree("run-cli-diff4");
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff", "run-cli-diff4", "--json", "--patch"]);

    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.patch).toContain("+alpha");
  });

  it("reports a missing worktree and sets a failing exit code", () => {
    const repo = makeGitRepo();
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff", "run-missing"]);

    expect(lines.join("\n")).toContain("No worktree found for run run-missing");
    expect(process.exitCode).toBe(1);
  });

  it("prints usage when run-id is omitted", () => {
    const repo = makeGitRepo();
    process.env.AUTOLOOP_PROJECT_DIR = repo;

    const lines = captureLog();
    dispatchWorktree(["diff"]);

    expect(lines.join("\n")).toContain(
      "Usage: autoloop worktree diff <run-id> [--patch] [--json]",
    );
  });

  it("mentions diff in the worktree usage text", () => {
    const lines = captureLog();
    dispatchWorktree(["--help"]);

    expect(lines.join("\n")).toContain("autoloop worktree diff <run-id>");
  });
});
