import { Hono } from "hono";

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

export function createApp(ctx: KanbanContext): Hono {
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

  return app;
}
