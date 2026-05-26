import { Hono } from "hono";
import { apiRoutes } from "./routes/api.js";
import { pageRoutes } from "./routes/pages.js";
import { createStubRuntime, type KanbanRuntime } from "./runtime.js";
import type { TaskStore } from "./task_store.js";

export interface PresetInfo {
  name: string;
  description: string;
}

export interface KanbanContext {
  projectDir: string;
  stateDir: string;
  bundleRoot: string;
  selfCmd: string;
  autoloopBin: string;
  host?: string;
  port?: number;
  listPresets: (projectDir: string) => PresetInfo[];
}

export function createApp(
  ctx: KanbanContext,
  store: TaskStore,
  runtime: KanbanRuntime = createStubRuntime(),
): Hono {
  const app = new Hono();

  const host = ctx.host ?? "127.0.0.1";
  const port = ctx.port ?? 4801;

  if (host !== "127.0.0.1" && host !== "localhost") {
    app.use("/api/*", async (c, next) => {
      const origin = c.req.header("origin");
      const expected = `http://${host}:${port}`;
      if (origin && origin !== expected) {
        return c.json({ error: "origin mismatch" }, 403);
      }
      await next();
    });
  }

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  pageRoutes(app, ctx, store, runtime);
  apiRoutes(app, ctx, store, runtime);

  return app;
}
