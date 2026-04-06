import { Hono } from "hono";
import { apiRoutes } from "./routes/api.js";

export interface DashboardContext {
  registryPath: string;
  journalPath: string;
  bundleRoot: string;
  projectDir: string;
  selfCmd: string;
}

export function createApp(ctx: DashboardContext): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.route("/api", apiRoutes(ctx));

  return app;
}
