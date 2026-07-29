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

  // Enforce browser same-origin on /api/* whenever Origin is present.
  // Compare against the request Host + scheme (TLS or first X-Forwarded-Proto),
  // not the bind address, so wildcard binds and reverse proxies stay usable.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!origin) {
      await next();
      return;
    }
    const host = c.req.header("host");
    if (!host) {
      return c.json({ error: "origin mismatch" }, 403);
    }
    const forwarded = c.req.header("x-forwarded-proto");
    const proto = forwarded?.split(",")[0]?.trim().toLowerCase();
    const scheme =
      proto === "https" || proto === "http"
        ? proto
        : c.req.url.startsWith("https:")
          ? "https"
          : "http";
    try {
      const parsed = new URL(origin);
      if (
        parsed.origin !== origin ||
        parsed.protocol !== `${scheme}:` ||
        parsed.host.toLowerCase() !== host.toLowerCase()
      ) {
        return c.json({ error: "origin mismatch" }, 403);
      }
    } catch {
      return c.json({ error: "origin mismatch" }, 403);
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  pageRoutes(app, ctx, store, runtime);
  apiRoutes(app, ctx, store, runtime);

  return app;
}
