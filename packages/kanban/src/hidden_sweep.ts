// Sweep workspaces from tasks parked in hidden columns (done/cancelled/
// duplicate/merging). Only reclaims dirs that live under `autoloopHome()` —
// user-owned checkouts outside ~/.autoloop (project repos, workplace dirs) are
// always preserved.
//
// Scope: runs across ALL workspaces (scope="all"). The dashboard is a single
// process but tasks.jsonl is per-scope; a sweep scoped to just the launch
// workspace would leak hidden-column sessions from every other scope.

import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { autoloopHome } from "./paths.js";
import {
  HIDDEN_COLUMNS,
  type KanbanColumn,
  type Task,
  type TaskStore,
} from "./task_store.js";

export interface HiddenSweepResult {
  sessionsDeleted: number;
  workspacesDeleted: number;
  errors: number;
}

/** True iff `p` resolves to a strict descendant of `autoloopHome()` (not the
 * root itself). Gates workspace deletion — we only reclaim dirs the dashboard
 * manufactured under its own home. */
export function isAutoloopOwnedPath(p: string): boolean {
  try {
    const abs = resolve(p);
    const home = resolve(autoloopHome());
    if (abs === home) return false;
    return abs.startsWith(home + sep);
  } catch {
    return false;
  }
}

export function sweepHiddenTaskSessions(store: TaskStore): HiddenSweepResult {
  const result: HiddenSweepResult = {
    sessionsDeleted: 0,
    workspacesDeleted: 0,
    errors: 0,
  };
  const hidden = new Set<KanbanColumn>(HIDDEN_COLUMNS);
  let tasks: Task[];
  try {
    tasks = store.list({ scope: "all", includeDone: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[autoloop-kanban] hidden-sweep list failed: ${msg}\n`,
    );
    result.errors++;
    return result;
  }
  for (const t of tasks) {
    if (!t.column || !hidden.has(t.column)) continue;
    // Autoloop run artifacts live under state-dir/runs/<runId>; hidden-sweep leaves them untouched for now.
    const ws = t.autoloop?.workspace;
    if (ws && isAutoloopOwnedPath(ws) && existsSync(ws)) {
      try {
        rmSync(ws, { recursive: true, force: true });
        result.workspacesDeleted++;
      } catch (err) {
        result.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[autoloop-kanban] hidden-sweep rmdir ${ws} failed: ${msg}\n`,
        );
      }
    }
  }
  return result;
}
