import { spawn } from "node:child_process";
import { Hono } from "hono";
import { listPresetsWithDescriptions } from "../../chains/load.js";
import { readRunLines, resolveRunJournalPath } from "../../harness/journal.js";
import { categorizeRuns } from "../../loops/health.js";
import { mergedFindRunByPrefix } from "../../registry/discover.js";
import type { RunRecord } from "../../registry/types.js";
import { metaDirForRun, readMeta } from "../../worktree/meta.js";
import type { DashboardContext } from "../app.js";

function enrichWithWorktreeMeta(stateDir: string, record: RunRecord): void {
  if (record.isolation_mode !== "worktree") return;
  const metaDir = metaDirForRun(stateDir, record.run_id);
  const meta = readMeta(metaDir);
  if (!meta || meta.status !== "merged") return;
  record.worktree_merged = true;
  record.worktree_merged_at = meta.merged_at;
  record.worktree_merge_strategy = meta.merge_strategy;
}

function enrichRecords(stateDir: string, records: RunRecord[]): void {
  for (const r of records) enrichWithWorktreeMeta(stateDir, r);
}

export function apiRoutes(ctx: DashboardContext): Hono {
  const api = new Hono();

  api.get("/runs", (c) => {
    const result = categorizeRuns(ctx.stateDir);
    for (const bucket of [
      result.active,
      result.watching,
      result.stuck,
      result.recentFailed,
      result.recentCompleted,
    ]) {
      enrichRecords(ctx.stateDir, bucket);
    }
    return c.json(result);
  });

  api.get("/runs/:id", (c) => {
    const id = c.req.param("id");
    const result = mergedFindRunByPrefix(ctx.stateDir, id);
    if (result === undefined) {
      return c.json({ error: "not found" }, 404);
    }
    if (Array.isArray(result)) {
      return c.json(
        { error: "ambiguous prefix", candidates: result.map((r) => r.run_id) },
        409,
      );
    }
    enrichWithWorktreeMeta(ctx.stateDir, result);
    return c.json(result);
  });

  api.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const result = mergedFindRunByPrefix(ctx.stateDir, id);
    if (Array.isArray(result)) {
      return c.json(
        { error: "ambiguous prefix", candidates: result.map((r) => r.run_id) },
        409,
      );
    }

    const runId = result?.run_id || id;
    const runJournal =
      result?.journal_file || resolveRunJournalPath(ctx.stateDir, runId);
    const lines = runJournal
      ? readRunLines(runJournal, runId)
      : readRunLines(ctx.journalPath, runId);
    const events = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
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
    if (!prompt || typeof prompt !== "string" || prompt.length > 10_000) {
      return c.json({ error: "prompt required (max 10000 chars)" }, 400);
    }
    if (preset) {
      const validPresets = listPresetsWithDescriptions(ctx.projectDir);
      if (!validPresets.some((p) => p.name === preset)) {
        return c.json({ error: "unknown preset" }, 400);
      }
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
