import { Hono } from "hono";
import { apiRoutes } from "./routes/api.js";
import { pageRoutes } from "./routes/pages.js";

export interface PresetInfo {
  name: string;
  description: string;
}

export interface DashboardContext {
  registryPath: string;
  journalPath: string;
  stateDir: string;
  bundleRoot: string;
  projectDir: string;
  selfCmd: string;
  host?: string;
  port?: number;
  /**
   * Inject the preset list for this project. Dashboard itself doesn't know
   * which presets ship — the CLI owns that list. Return `[]` if unavailable.
   */
  listPresets: (projectDir: string) => PresetInfo[];
}

export function createApp(ctx: DashboardContext): Hono {
  const app = new Hono();

  const host = ctx.host ?? "127.0.0.1";
  const port = ctx.port ?? 4800;

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

  app.route("/api", apiRoutes(ctx));

  pageRoutes(app, ctx.projectDir);

  return app;
}
