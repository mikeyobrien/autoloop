import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "../loops/health.js";
import { getRun } from "../registry/read.js";
import { shellQuote } from "../utils.js";
import type { WorktreeStatus } from "./meta.js";
import { isOrphanWorktree, readMeta, updateStatus } from "./meta.js";

export interface CleanOpts {
  mainProjectDir: string;
  mainStateDir: string;
  runId?: string;
  all?: boolean;
  force?: boolean;
}

export interface CleanResult {
  removed: string[];
  skipped: string[];
}

const TERMINAL_STATUSES: ReadonlySet<WorktreeStatus> = new Set([
  "merged",
  "failed",
  "removed",
]);

export function cleanWorktrees(opts: CleanOpts): CleanResult {
  const { mainProjectDir, mainStateDir, force = false } = opts;
  const worktreesDir = join(mainStateDir, "worktrees");

  if (!existsSync(worktreesDir)) return { removed: [], skipped: [] };

  const removed: string[] = [];
  const skipped: string[] = [];

  const entries = opts.runId ? [opts.runId] : listWorktreeRunIds(worktreesDir);

  for (const runId of entries) {
    const metaDir = join(worktreesDir, runId);
    const meta = readMeta(metaDir);
    if (!meta) {
      skipped.push(runId);
      continue;
    }

    const orphan = isOrphanWorktree(meta);

    // Skip running worktrees unless --force, orphaned, or owner process is dead
    if (meta.status === "running" && !force && !orphan) {
      const registryPath = join(mainStateDir, "registry.jsonl");
      const record = getRun(registryPath, runId);
      const ownerDead = record?.pid != null && !isProcessAlive(record.pid);
      if (!ownerDead) {
        skipped.push(runId);
        continue;
      }
      // Owner process is dead — mark as failed and allow cleanup
      try {
        updateStatus(metaDir, "failed");
        meta.status = "failed";
      } catch {
        /* best-effort */
      }
    }

    // Without --all, only clean terminal-status or orphaned worktrees
    if (
      !opts.all &&
      !opts.runId &&
      !TERMINAL_STATUSES.has(meta.status) &&
      !force &&
      !orphan
    ) {
      skipped.push(runId);
      continue;
    }

    // Remove the git worktree
    if (existsSync(meta.worktree_path)) {
      try {
        const forceFlag = force ? " --force" : "";
        execSync(
          `git worktree remove ${shellQuote(meta.worktree_path)}${forceFlag}`,
          {
            cwd: mainProjectDir,
            stdio: "pipe",
          },
        );
      } catch {
        // Worktree may already be gone; try direct removal
        try {
          rmSync(meta.worktree_path, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }

    // Remove the branch
    try {
      const deleteFlag = force ? "-D" : "-d";
      execSync(`git branch ${deleteFlag} ${shellQuote(meta.branch)}`, {
        cwd: mainProjectDir,
        stdio: "pipe",
      });
    } catch {
      /* branch may already be gone */
    }

    // Update meta status and clean up meta directory
    try {
      updateStatus(metaDir, "removed");
    } catch {
      /* best-effort */
    }
    try {
      rmSync(metaDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }

    removed.push(runId);
  }

  return { removed, skipped };
}

function listWorktreeRunIds(worktreesDir: string): string[] {
  try {
    return readdirSync(worktreesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
