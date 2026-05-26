// Public entrypoint for embedding the kanban into a host HTTP server.
// Owns the installation-level lifecycle: startup stale-agent reset, initial
// hidden-sweep, stall-timeout sweeper, and orderly teardown (clear interval
// → close WS → shut down runtime PTYs). tmux sessions stay alive across
// dashboard restarts by design.

import type { Server as HttpServer } from "node:http";
import type { Hono } from "hono";
import { createApp, type KanbanContext } from "./app.js";
import { loadKanbanConfig } from "./config.js";
import { sweepHiddenTaskSessions } from "./hidden_sweep.js";
import type { KanbanRuntime } from "./runtime.js";
import { createKanbanRuntime } from "./runtime_live.js";
import type { TaskStore } from "./task_store.js";
import { installKanbanWs } from "./ws.js";

export interface InstallKanbanOptions {
  /** Stall-tick cadence in ms. Default 30_000. Pass 0 to disable the
   *  interval entirely (tests). */
  stallTickMs?: number;
  /** Test-only seam: inject a pre-built runtime instead of constructing one
   *  via `createKanbanRuntime`. Lets install-lifecycle tests assert against a
   *  stub without touching real tmux/node-pty. */
  runtime?: KanbanRuntime;
}

export interface InstallKanbanResult {
  app: Hono;
  runtime: KanbanRuntime;
  close(): void;
}

const DEFAULT_STALL_TICK_MS = 30_000;

export function installKanban(
  server: HttpServer,
  ctx: KanbanContext,
  store: TaskStore,
  opts: InstallKanbanOptions = {},
): InstallKanbanResult {
  // 1) Reset stale agent state carried over from a prior dashboard crash.
  //    Any task stuck at running/idle has no live PTY this process knows
  //    about — flip to detached so the UI shows the correct dot and the
  //    stall sweeper starts from a clean baseline.
  try {
    for (const t of store.list({ includeDone: true })) {
      if (t.autoloop?.state === "running" || t.autoloop?.state === "idle") {
        store.setAutoloop(t.id, { state: "detached", pid: undefined });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[autoloop-kanban] startup stale-agent reset failed: ${msg}\n`,
    );
  }

  // 2) Initial hidden-column sweep: reclaim autoloop-owned workspaces for
  //    done/cancelled/duplicate/merging tasks. Bounded-growth guarantee.
  try {
    const r = sweepHiddenTaskSessions(store);
    if (r.sessionsDeleted || r.workspacesDeleted || r.errors) {
      process.stderr.write(
        `[autoloop-kanban] hidden-column sweep: sessions=${r.sessionsDeleted} workspaces=${r.workspacesDeleted} errors=${r.errors}\n`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[autoloop-kanban] hidden-column sweep failed: ${msg}\n`,
    );
  }

  const runtime = opts.runtime ?? createKanbanRuntime(ctx, store);
  const app = createApp(ctx, store, runtime);
  const ws = installKanbanWs(server, store, runtime);

  // 3) Stall-timeout sweeper. Re-read config every tick so live edits to
  //    kanban.toml apply without a dashboard restart. `stall_timeout_ms <= 0`
  //    disables per-tick (early return), NOT by skipping the interval — so a
  //    user setting a timeout after boot still takes effect without restart.
  const tickMs = opts.stallTickMs ?? DEFAULT_STALL_TICK_MS;
  let stallTick: NodeJS.Timeout | null = null;
  if (tickMs > 0) {
    stallTick = setInterval(() => {
      try {
        const cfg = loadKanbanConfig();
        const stallMs = cfg.stallTimeoutMs ?? 0;
        if (!stallMs || stallMs <= 0) return;
        const now = Date.now();
        for (const { taskId, lastDataMs } of runtime.statsLivePtys()) {
          const idle = now - lastDataMs;
          if (idle > stallMs) {
            process.stderr.write(
              `[autoloop-kanban] stall-kill task=${taskId} idle=${idle}ms (>${stallMs})\n`,
            );
            runtime.killAgent(taskId);
            // killAgent stamps state=detached; stall-kill wants state=crashed
            // to surface "worker was unhealthy" in the UI.
            store.setAutoloop(taskId, { state: "crashed", pid: undefined });
          }
        }
      } catch {
        /* keep ticking even if a read/config op blips */
      }
    }, tickMs);
    stallTick.unref?.();
  }

  return {
    app,
    runtime,
    close: () => {
      if (stallTick) clearInterval(stallTick);
      ws.close();
      runtime.shutdown();
    },
  };
}
