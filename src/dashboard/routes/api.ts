import { Hono } from "hono";
import { spawn } from "node:child_process";
import { categorizeRuns } from "../../loops/health.js";
import { findRunByPrefix } from "../../registry/read.js";
import { readRunLines } from "../../harness/journal.js";
import { listPresetsWithDescriptions } from "../../chains/load.js";
import type { DashboardContext } from "../app.js";

export function apiRoutes(ctx: DashboardContext): Hono {
  const api = new Hono();

  api.get("/runs", (c) => {
    const result = categorizeRuns(ctx.registryPath);
    return c.json(result);
  });

  api.get("/runs/:id", (c) => {
    const id = c.req.param("id");
    const result = findRunByPrefix(ctx.registryPath, id);
    if (result === undefined) {
      return c.json({ error: "not found" }, 404);
    }
    if (Array.isArray(result)) {
      return c.json({ error: "ambiguous prefix", candidates: result.map((r) => r.run_id) }, 409);
    }
    return c.json(result);
  });

  api.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const lines = readRunLines(ctx.journalPath, id);
    const events = lines.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
    return c.json({ events });
  });

  api.get("/presets", (c) => {
    const presets = listPresetsWithDescriptions(ctx.projectDir);
    return c.json({ presets });
  });

  api.post("/runs", async (c) => {
    const body = await c.req.json<{ prompt?: string; preset?: string }>();
    const prompt = body.prompt;
    const preset = body.preset;
    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400);
    }

    const args: string[] = ["run"];
    if (preset) {
      args.push("--preset", preset);
    }
    args.push(prompt);

    const child = spawn(ctx.selfCmd.replace(/'/g, ""), args, {
      cwd: ctx.projectDir,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return c.json({ status: "accepted", pid: child.pid }, 202);
  });

  return api;
}
