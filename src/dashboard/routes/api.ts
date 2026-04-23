import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  appendOperatorEvent,
  latestIterationForRun,
  readRunLines,
  resolveRunJournalPath,
} from "@mobrienv/autoloop-core/journal";
import { Hono } from "hono";
import { listPresetsWithDescriptions } from "../../chains/load.js";
import { collectArtifacts } from "../../harness/artifacts.js";
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

  api.get("/runs/:id/artifacts", (c) => {
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
    const workDir = result?.work_dir || result?.worktree_path || ctx.projectDir;
    const artifacts = collectArtifacts(lines, ctx.projectDir, workDir);
    return c.json(artifacts);
  });

  api.get("/runs/:id/artifact", (c) => {
    const filePath = c.req.query("path");
    if (!filePath || filePath.trim() === "") {
      return c.json({ error: "path required" }, 400);
    }
    if (filePath.includes("..")) {
      return c.json({ error: "path traversal not allowed" }, 400);
    }
    if (filePath.startsWith("/")) {
      return c.json({ error: "absolute paths not allowed" }, 400);
    }
    if (!filePath.endsWith(".md")) {
      return c.json({ error: "only .md files supported" }, 400);
    }
    const id = c.req.param("id");
    const result = mergedFindRunByPrefix(ctx.stateDir, id);
    if (Array.isArray(result)) {
      return c.json(
        { error: "ambiguous prefix", candidates: result.map((r) => r.run_id) },
        409,
      );
    }
    const workDir = result?.work_dir || result?.worktree_path || ctx.projectDir;
    const fullPath = join(workDir, filePath);
    if (!existsSync(fullPath)) {
      return c.json({ error: "file not found" }, 404);
    }
    // Resolve symlinks and verify the real path stays within workDir
    try {
      const realPath = realpathSync(fullPath);
      const realWorkDir = realpathSync(resolve(workDir));
      if (!realPath.startsWith(realWorkDir + "/")) {
        return c.json({ error: "path traversal not allowed" }, 400);
      }
    } catch {
      return c.json({ error: "file not found" }, 404);
    }
    const content = readFileSync(fullPath, "utf-8");
    return c.text(content);
  });

  api.get("/presets", (c) => {
    const presets = listPresetsWithDescriptions(ctx.projectDir);
    return c.json({ presets });
  });

  api.post("/runs/:id/guide", async (c) => {
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
    const body = await c.req.json<{ message?: string }>();
    const message = body.message;
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return c.json({ error: "message required" }, 400);
    }
    if (message.length > 10_000) {
      return c.json({ error: "message too long (max 10000 chars)" }, 400);
    }
    const runId = result.run_id;
    const journalPath =
      result.journal_file ||
      resolveRunJournalPath(ctx.stateDir, runId) ||
      ctx.journalPath;
    const iteration = latestIterationForRun(journalPath, runId) || "1";
    appendOperatorEvent(
      journalPath,
      runId,
      iteration,
      "operator.guidance",
      message.trim(),
    );
    return c.json({ status: "ok" });
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
