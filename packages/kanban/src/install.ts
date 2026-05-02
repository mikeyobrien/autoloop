// Public entrypoint for embedding the kanban into a host HTTP server. The
// slice-11 CLI wraps this. Wires: real runtime → Hono app → WS upgrade
// handler. Slice 10 will extend `close()` to own PTY shutdown + stall
// sweep teardown; for now it only detaches the WS upgrade listener.

import type { Server as HttpServer } from "node:http";
import type { Hono } from "hono";
import { createApp, type KanbanContext } from "./app.js";
import type { KanbanRuntime } from "./runtime.js";
import { createKanbanRuntime } from "./runtime_live.js";
import type { TaskStore } from "./task_store.js";
import { installKanbanWs } from "./ws.js";

export interface InstallKanbanResult {
  app: Hono;
  runtime: KanbanRuntime;
  close(): void;
}

export function installKanban(
  server: HttpServer,
  ctx: KanbanContext,
  store: TaskStore,
): InstallKanbanResult {
  const runtime = createKanbanRuntime(ctx, store);
  const app = createApp(ctx, store, runtime);
  const ws = installKanbanWs(server, store, runtime);
  return {
    app,
    runtime,
    close: () => {
      ws.close();
    },
  };
}
