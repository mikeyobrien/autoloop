import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { metaDirForRun, writeMeta } from "./meta.js";
import type { WorktreeMeta } from "./meta.js";
import { shellQuote } from "../utils.js";

export interface CreateWorktreeOpts {
  mainProjectDir: string;
  mainStateDir: string;
  runId: string;
  branchPrefix?: string;
  baseBranch?: string;
  mergeStrategy?: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branch: string;
  metaDir: string;
}

export function createWorktree(opts: CreateWorktreeOpts): CreateWorktreeResult {
  const {
    mainProjectDir,
    mainStateDir,
    runId,
    branchPrefix = "autoloop",
    mergeStrategy = "squash",
  } = opts;

  const baseBranch = opts.baseBranch ?? detectBaseBranch(mainProjectDir);
  const branch = `${branchPrefix}/${runId}`;
  const metaDir = metaDirForRun(mainStateDir, runId);
  const worktreePath = join(metaDir, "tree");

  // Fail fast if branch already exists
  if (branchExists(mainProjectDir, branch)) {
    throw new Error(`branch "${branch}" already exists; cannot create worktree for run ${runId}`);
  }

  try {
    execSync(`git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)}`, {
      cwd: mainProjectDir,
      stdio: "pipe",
    });
  } catch (err: unknown) {
    // Clean up partial state on failure
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
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

