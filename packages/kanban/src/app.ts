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
  /**
   * Honor `X-Forwarded-Proto` for origin scheme. Default false. Enable only
   * behind a reverse proxy that strips client-supplied forwarded headers.
   */
  trustProxy?: boolean;
  listPresets: (projectDir: string) => PresetInfo[];
}

export function createApp(
  ctx: KanbanContext,
  store: TaskStore,
  runtime: KanbanRuntime = createStubRuntime(),
): Hono {
  const app = new Hono();
  const trustProxy = ctx.trustProxy === true;

  // Enforce browser same-origin on /api/* whenever Origin is present.
  // Compare against the request Host + scheme (direct TLS, or forwarded proto
  // only when trustProxy is enabled), not the bind address.
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
    // Direct TLS/HTTPS wins. Forwarded proto is consulted only for plaintext
    // backends behind an explicit trusted reverse proxy.
    let scheme: "http" | "https" = c.req.url.startsWith("https:")
      ? "https"
      : "http";
    if (scheme === "http" && trustProxy) {
      const forwarded = c.req.header("x-forwarded-proto");
      const proto = forwarded?.split(",")[0]?.trim().toLowerCase();
      if (proto === "https" || proto === "http") scheme = proto;
    }
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
