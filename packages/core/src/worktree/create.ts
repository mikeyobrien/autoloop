import { execSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { shellQuote } from "@mobrienv/autoloop-core";
import type { WorktreeMeta } from "./meta.js";
import { metaDirForRun, writeMeta } from "./meta.js";

export interface CreateWorktreeOpts {
  mainStateDir: string;
  runId: string;
  branchPrefix?: string;
  baseBranch?: string;
  mergeStrategy?: string;
  workDir: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branch: string;
  metaDir: string;
}

export function createWorktree(opts: CreateWorktreeOpts): CreateWorktreeResult {
  const {
    mainStateDir,
    runId,
    workDir,
    branchPrefix = "autoloop",
    mergeStrategy = "squash",
  } = opts;

  const gitRoot = resolveGitRoot(workDir);
  const baseBranch = opts.baseBranch ?? detectBaseBranch(gitRoot);
  const branch = `${branchPrefix}/${runId}`;
  const metaDir = metaDirForRun(mainStateDir, runId);
  const worktreePath = join(metaDir, "tree");

  // Fail fast if branch already exists
  if (branchExists(gitRoot, branch)) {
    throw new Error(
      `branch "${branch}" already exists; cannot create worktree for run ${runId}`,
    );
  }

  try {
    execSync(
      `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)}`,
      {
        cwd: gitRoot,
        stdio: "pipe",
      },
    );
  } catch (err: unknown) {
    // Clean up partial state on failure
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree add failed: ${msg}`);
  }

  const meta: WorktreeMeta = {
    run_id: runId,
    branch,
    worktree_path: worktreePath,
    base_branch: baseBranch,
    status: "running",
    merge_strategy: mergeStrategy,
    created_at: new Date().toISOString(),
    merged_at: null,
    removed_at: null,
  };
  writeMeta(metaDir, meta);

  return { worktreePath, branch, metaDir };
}

export function resolveGitRoot(cwd: string): string {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return realpathSync(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `autoloop run --worktree requires the current directory to be inside a git repository. ` +
        `git rev-parse --show-toplevel failed in ${cwd}: ${msg}`,
    );
  }
}

export function tryResolveGitRoot(cwd: string): string | undefined {
  try {
    return resolveGitRoot(cwd);
  } catch {
    return undefined;
  }
}

function detectBaseBranch(projectDir: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "main";
  }
}

function branchExists(projectDir: string, branch: string): boolean {
  try {
    execSync(`git rev-parse --verify refs/heads/${shellQuote(branch)}`, {
      cwd: projectDir,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
