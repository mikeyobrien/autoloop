// Live KanbanRuntime: owns the PTY + tmux session maps and the
// auto-dispatch cooldown map. Routes reach PTY/tmux state only through the
// KanbanRuntime interface; this module is the seam that replaces the stub
// runtime shipped in slice 8.
//
// Stall-timeout sweeping, startup hidden-sweep, and stale-agent reset are
// all DEFERRED to slice 10. This slice only adds the ensure/kill/dispatch
// primitives + the worktree-reclaim delegate.

import type { KanbanContext } from "./app.js";
import { loadKanbanConfig } from "./config.js";
import { PtySession } from "./pty_session.js";
import { reclaimWorktreeForTask } from "./reclaim.js";
import type { KanbanRuntime, ReclaimWorktreeResult } from "./runtime.js";
import {
  spawnAutoloopForTask as defaultSpawn,
  runHook,
  type SpawnAutoloopOptions,
  type SpawnAutoloopResult,
} from "./spawn.js";
import type { Task, TaskStore } from "./task_store.js";
import { tmuxKillSession, tmuxSessionName } from "./tmux.js";
import { atCap, pickNextQueued } from "./worker.js";

const AUTO_DISPATCH_COOLDOWN_MS = 10_000;

/** Signature of the spawn function we depend on. Exported so tests can
 *  inject a stub without jest/vitest module mocking gymnastics. */
export type SpawnAutoloopFn = (
  task: Task,
  cols: number,
  rows: number,
  store: TaskStore,
  opts: SpawnAutoloopOptions,
) => SpawnAutoloopResult;

export interface CreateKanbanRuntimeOptions {
  /** Test-only override: swap the spawn implementation. Defaults to the
   *  real `spawnAutoloopForTask` from ./spawn.js. */
  spawnFn?: SpawnAutoloopFn;
}

export function createKanbanRuntime(
  ctx: KanbanContext,
  store: TaskStore,
  opts: CreateKanbanRuntimeOptions = {},
): KanbanRuntime {
  const ptys = new Map<string, PtySession>();
  const taskSessions = new Map<string, string>();
  const lastAutoDispatchAt = new Map<string, number>();
  const spawnFn = opts.spawnFn ?? defaultSpawn;

  const hasLivePty = (id: string): boolean => {
    const p = ptys.get(id);
    return !!p && p.isAlive();
  };

  const tryAutoDispatch = (): void => {
    try {
      const cfg = loadKanbanConfig();
      const cap = cfg.maxConcurrentByColumn.in_progress;
      const now = Date.now();
      const isEligible = (id: string) => {
        const last = lastAutoDispatchAt.get(id) ?? 0;
        return now - last >= AUTO_DISPATCH_COOLDOWN_MS;
      };
      const tasks = store.list({ includeDone: false });
      if (atCap(tasks, "in_progress", cap, hasLivePty)) return;
      const next = pickNextQueued(tasks, "in_progress", hasLivePty, isEligible);
      if (!next) return;
      lastAutoDispatchAt.set(next.id, now);
      ensurePtyForTask(next.id, 80, 24);
      process.stderr.write(
        `[autoloop-kanban] auto-dispatch task=${next.id}${cap != null ? ` (cap=${cap})` : " (uncapped)"}\n`,
      );
    } catch (err) {
      process.stderr.write(
        `[autoloop-kanban] auto-dispatch failed — ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  const ensurePtyForTask = (
    taskId: string,
    cols: number,
    rows: number,
  ): PtySession => {
    const existing = ptys.get(taskId);
    if (existing?.isAlive()) return existing;
    const task = store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const cfg = loadKanbanConfig();
    const spawned = spawnFn(task, cols, rows, store, {
      autoloopBin: ctx.autoloopBin,
      defaultPreset: cfg.defaultPreset,
      hooks: cfg.hooks,
    });
    taskSessions.set(taskId, spawned.tmuxSession);
    const self = new PtySession(spawned.pty, (exitInfo) => {
      ptys.delete(taskId);
      // Only overwrite state when the store still thinks the PTY is alive;
      // user-initiated kill paths stamp `detached` first.
      const cur = store.get(taskId);
      if (
        cur?.autoloop?.state === "running" ||
        cur?.autoloop?.state === "idle"
      ) {
        const exitCode = exitInfo?.exitCode;
        const signal = exitInfo?.signal;
        let state: "crashed" | "detached" = "detached";
        if (typeof exitCode === "number" && exitCode > 0) state = "crashed";
        else if (typeof signal === "number" && signal > 0) state = "crashed";
        store.setAutoloop(taskId, {
          state,
          exit_code: typeof exitCode === "number" ? exitCode : undefined,
          pid: undefined,
        });
      }
      // Fire after_run hook (failure logged, not fatal).
      try {
        if (cfg.hooks.after_run?.trim()) {
          runHook(
            "after_run",
            cfg.hooks.after_run,
            spawned.cwd,
            cfg.hooks.timeout_ms,
            taskId,
          );
        }
      } catch {
        /* hook failures are non-fatal */
      }
      tryAutoDispatch();
    });
    ptys.set(taskId, self);
    // Note: spawnAutoloopForTask already calls setAutoloop on first spawn.
    // Do NOT re-call here — it would overwrite `started` with a later
    // timestamp on respawn.
    return self;
  };

  const killAgent = (id: string): boolean => {
    const pty = ptys.get(id);
    if (pty) {
      try {
        pty.kill();
      } catch {
        /* already dead */
      }
      ptys.delete(id);
    }
    const stored = taskSessions.get(id);
    const tmuxName = stored ?? tmuxSessionName({ id } as Task);
    tmuxKillSession(tmuxName);
    taskSessions.delete(id);
    const t = store.get(id);
    if (t?.autoloop)
      store.setAutoloop(id, { state: "detached", pid: undefined });
    tryAutoDispatch();
    return true;
  };

  const reclaim = (t: Task): ReclaimWorktreeResult =>
    reclaimWorktreeForTask(store, t);

  const shutdown = (): void => {
    for (const p of ptys.values()) {
      try {
        p.kill();
      } catch {
        /* already dead */
      }
    }
    ptys.clear();
    // Leave taskSessions populated — tmux sessions are intentionally NOT
    // killed here; a later ensurePtyForTask can respawn a fresh PtySession
    // inside the existing tmux session if it's still there.
  };

  const statsLivePtys = (): Array<{ taskId: string; lastDataMs: number }> => {
    const out: Array<{ taskId: string; lastDataMs: number }> = [];
    for (const [taskId, p] of ptys.entries()) {
      if (p.isAlive()) out.push({ taskId, lastDataMs: p.lastDataMs });
    }
    return out;
  };

  return {
    ensurePtyForTask,
    killAgent,
    tryAutoDispatch,
    reclaimWorktreeForTask: reclaim,
    hasLivePty,
    shutdown,
    statsLivePtys,
  };
}
