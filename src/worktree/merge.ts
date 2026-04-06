import { execSync } from "node:child_process";
import { readMeta, updateStatus } from "./meta.js";
import type { WorktreeMeta } from "./meta.js";
import { shellQuote } from "../utils.js";

export interface MergeOpts {
  mainProjectDir: string;
  metaDir: string;
  strategy?: "squash" | "merge" | "rebase";
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  recoveryHint?: string;
}

export function mergeWorktree(opts: MergeOpts): MergeResult {
  const { mainProjectDir, metaDir, strategy = "squash" } = opts;

  const meta = readMeta(metaDir);
  if (!meta) throw new Error(`no worktree meta found in ${metaDir}`);

  validateMergeStatus(meta);

  const baseBranch = meta.base_branch;
  const branch = meta.branch;

  // Checkout base branch
  exec(mainProjectDir, `git checkout ${shellQuote(baseBranch)}`);

  try {
    if (strategy === "squash") {
      exec(mainProjectDir, `git merge --squash ${shellQuote(branch)}`);
      exec(mainProjectDir, `git commit --no-edit -m ${shellQuote(`merge worktree ${meta.run_id} (squash)`)}`);
    } else if (strategy === "rebase") {
      exec(mainProjectDir, `git rebase ${shellQuote(branch)}`);
    } else {
      exec(mainProjectDir, `git merge --no-ff ${shellQuote(branch)} -m ${shellQuote(`merge worktree ${meta.run_id}`)}`);
    }
  } catch (err: unknown) {
    // Attempt to detect conflicts and abort
    const msg = err instanceof Error ? err.message : String(err);
    const conflicts = detectConflicts(mainProjectDir);
    try {
      if (strategy === "rebase") {
        exec(mainProjectDir, "git rebase --abort");
      } else {
        exec(mainProjectDir, "git merge --abort");
      }
    } catch { /* abort best-effort */ }

    if (conflicts.length > 0) {
      return {
        success: false,
        conflicts,
        recoveryHint: `Resolve conflicts manually, then run: git merge ${branch}`,
      };
    }
    throw new Error(`merge failed: ${msg}`);
  }

  updateStatus(metaDir, "merged");
  return { success: true };
}

function validateMergeStatus(meta: WorktreeMeta): void {
  if (meta.status === "running") {
    throw new Error(`cannot merge worktree ${meta.run_id}: still running`);
  }
  if (meta.status === "merged") {
    throw new Error(`worktree ${meta.run_id} is already merged`);
  }
  if (meta.status === "removed") {
    throw new Error(`worktree ${meta.run_id} has been removed`);
  }
}

function detectConflicts(cwd: string): string[] {
  try {
    const out = execSync("git diff --name-only --diff-filter=U", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

function exec(cwd: string, cmd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe" });
}

