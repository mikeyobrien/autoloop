// Runtime seam for PTY/tmux/auto-dispatch state that the kanban routes need
// to reach. Slice 8 ships only the stub (all methods no-op / throw); slice 9
// installs the real runtime that owns the `ptys` + `taskSessions` maps and
// wires ensurePtyForTask + killAgent + tryAutoDispatch + reclaimWorktreeForTask
// against live PTY sessions.

import type { PtySession } from "./pty_session.js";
import type { Task } from "./task_store.js";

export interface ReclaimWorktreeResult {
  removed: number;
  preserved: number;
  errors: number;
}

export interface KanbanRuntime {
  /** Ensure a PTY+tmux session exists for the task. Idempotent; returns the
   * live PtySession. Slice 8 stub throws — routes catch and surface 500. */
  ensurePtyForTask(taskId: string, cols: number, rows: number): PtySession;
  /** Kill PTY + tmux for the task. Returns true if a kill was issued. */
  killAgent(taskId: string): boolean;
  /** Tick the auto-dispatcher. Called on column transitions. */
  tryAutoDispatch(): void;
  /** Reclaim a worktree for a task leaving the board. */
  reclaimWorktreeForTask(task: Task): ReclaimWorktreeResult;
  /** Has a live PTY for this task id right now? */
  hasLivePty(taskId: string): boolean;
  /** Shut the runtime down: kill every attached PTY and drop them from the
   *  cache. tmux sessions are intentionally LEFT ALIVE so autoloop runs
   *  keep going across dashboard restarts. Idempotent. */
  shutdown(): void;
  /** Snapshot of live PTYs for the stall sweeper. One entry per task with an
   *  alive PtySession. `lastDataMs` is the ms-epoch of the most recent byte
   *  read from the PTY. Empty array when no live PTYs. */
  statsLivePtys(): Array<{ taskId: string; lastDataMs: number }>;
}

export function createStubRuntime(): KanbanRuntime {
  return {
    ensurePtyForTask(): PtySession {
      throw new Error(
        "KanbanRuntime not installed — WS layer lands in slice 9",
      );
    },
    killAgent(): boolean {
      return false;
    },
    tryAutoDispatch(): void {
      /* stub */
    },
    reclaimWorktreeForTask(): ReclaimWorktreeResult {
      return { removed: 0, preserved: 0, errors: 0 };
    },
    hasLivePty(): boolean {
      return false;
    },
    shutdown(): void {
      /* stub */
    },
    statsLivePtys(): Array<{ taskId: string; lastDataMs: number }> {
      return [];
    },
  };
}
