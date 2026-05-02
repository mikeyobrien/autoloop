// Hidden-column worktree reclamation orchestrator. Wraps `reclaimTaskWorktree`
// with TaskStore updates + per-outcome logging. Extracted into its own module
// so the slice-10 hidden sweep can share the exact same code path the route
// layer calls when a card moves to done/cancelled.

import { existsSync } from "node:fs";
import type { Task, TaskStore } from "./task_store.js";
import { reclaimTaskWorktree, resolveRepoRoot } from "./worktree.js";

export interface ReclaimCounts {
  removed: number;
  preserved: number;
  errors: number;
}

export function reclaimWorktreeForTask(
  store: TaskStore,
  t: Task,
): ReclaimCounts {
  const out: ReclaimCounts = { removed: 0, preserved: 0, errors: 0 };
  const wt = t.worktree;
  if (!wt?.path) return out;
  if (!existsSync(wt.path)) {
    const repoRoot = resolveRepoRoot(wt.path);
    if (repoRoot) {
      reclaimTaskWorktree({
        repoRoot,
        worktreeDir: wt.path,
        branch: wt.branch,
      });
    }
    store.setWorktree(t.id, null);
    return out;
  }
  const repoRoot = resolveRepoRoot(wt.path);
  if (!repoRoot) {
    out.errors++;
    process.stderr.write(
      `[autoloop-kanban] worktree reclaim task=${t.id}: cannot resolve repoRoot from ${wt.path}\n`,
    );
    return out;
  }
  const r = reclaimTaskWorktree({
    repoRoot,
    worktreeDir: wt.path,
    branch: wt.branch,
  });
  switch (r.outcome) {
    case "removed":
      out.removed++;
      store.setWorktree(t.id, null);
      break;
    case "missing":
      store.setWorktree(t.id, null);
      break;
    case "preserved":
      out.preserved++;
      store.setWorktree(t.id, { preserved_reason: r.reason });
      process.stderr.write(
        `[autoloop-kanban] worktree preserved task=${t.id} reason=${r.reason} path=${wt.path} — reclaim manually with 'git worktree remove' + 'git branch -D ${wt.branch}'\n`,
      );
      break;
    case "error":
      out.errors++;
      process.stderr.write(
        `[autoloop-kanban] worktree reclaim task=${t.id} failed: ${r.message}\n`,
      );
      break;
  }
  return out;
}
