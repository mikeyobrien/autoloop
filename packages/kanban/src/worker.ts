// Per-column concurrency cap + auto-dispatch helpers.
//
// Pure functions only — the kanban server owns PTY lifecycle + config reads
// and calls these to decide whether to spawn or skip. Manual click paths
// (play button, restart, WS attach) bypass these entirely; the cap only
// gates *auto* dispatch (card→in_progress with no explicit user spawn).

import type { KanbanColumn, Task } from "./task_store.js";

/** Count tasks currently occupying a column that ALSO have a live PTY
 *  (i.e. consume a worker slot). A task in `in_progress` without a PTY
 *  is "queued" — it doesn't count toward the cap because no worker is
 *  running for it yet. */
export function liveSlots(
  tasks: Task[],
  column: KanbanColumn,
  hasLivePty: (id: string) => boolean,
): number {
  let n = 0;
  for (const t of tasks)
    if ((t.column ?? "backlog") === column && hasLivePty(t.id)) n++;
  return n;
}

/** True if the column is at or above its configured cap. Undefined cap = unlimited. */
export function atCap(
  tasks: Task[],
  column: KanbanColumn,
  cap: number | undefined,
  hasLivePty: (id: string) => boolean,
): boolean {
  if (cap == null || cap <= 0) return false;
  return liveSlots(tasks, column, hasLivePty) >= cap;
}

/** Pick the next queued task in `column` that needs a worker slot — a task
 *  in the column without a live PTY. Ordered by priority asc (1 highest),
 *  then by created asc (FIFO within priority). Returns undefined if no
 *  task is waiting.
 *
 *  Tasks with `autoloop.state === "crashed"` are ALWAYS skipped — a crashed
 *  task means the last spawn exited on its own (tmux attach failed, autoloop
 *  died, etc). Auto-redispatching it re-hits the same failure, producing
 *  the tight `[kanban] auto-dispatch task=X` loop that thrashes the
 *  dashboard. User must explicitly click ⟳ restart / ▶ play to retry;
 *  those paths call ensurePtyForTask directly and bypass this filter.
 *
 *  Optional `isEligible` lets the caller add a short per-task cooldown so
 *  even non-crashed respawns can't thrash if something else drops the PTY
 *  repeatedly (e.g. WS handshake failure). */
export function pickNextQueued(
  tasks: Task[],
  column: KanbanColumn,
  hasLivePty: (id: string) => boolean,
  isEligible?: (id: string) => boolean,
): Task | undefined {
  const waiting = tasks.filter((t) => {
    if ((t.column ?? "backlog") !== column) return false;
    if (hasLivePty(t.id)) return false;
    if (t.autoloop?.state === "crashed") return false;
    if (isEligible && !isEligible(t.id)) return false;
    return true;
  });
  if (!waiting.length) return undefined;
  waiting.sort((a, b) => {
    const pa = a.priority ?? 3;
    const pb = b.priority ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.created ?? "").localeCompare(b.created ?? "");
  });
  return waiting[0];
}
