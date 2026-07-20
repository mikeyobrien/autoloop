// `autoloop stats` — cross-run analytics derived from the registry + journals.
//
// Groups runs by preset and reports counts, success rate, average iterations,
// average duration, and total journaled cost (from `backend.usage` events).
// Gives operators the "which presets actually finish, and what do they cost"
// view that single-run inspection can't.

import { join } from "node:path";
import { collectUsage } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import { readRunJournal } from "@mobrienv/autoloop-core/journal";
import { readRegistry } from "@mobrienv/autoloop-core/registry/read";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";

export interface PresetStats {
  preset: string;
  runs: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
  /** Runs whose persisted outcome is gate-verified (q6p.2). */
  verified: number;
  successRate: number | null;
  avgIterations: number | null;
  avgDurationS: number | null;
  costUsd: number;
  /** Cost per verified outcome (cost-per-outcome, not cost-per-run). */
  costPerVerified: number | null;
}

export function dispatchStats(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    printStatsUsage();
    return;
  }
  let json = false;
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else positionals.push(arg);
  }
  const projectDir = positionals[0] ?? resolveRuntimeProjectDir();
  const stateDir = config.stateDirPath(projectDir);
  const records = readRegistry(join(stateDir, "registry.jsonl"));
  const stats = computeStats(records, (runId) =>
    readRunJournal(stateDir, runId),
  );
  if (json) {
    console.log(JSON.stringify({ projectDir, presets: stats }, null, 2));
    return;
  }
  console.log(renderStats(projectDir, stats));
}

/**
 * Aggregate run records into per-preset stats. `journalForRun` supplies raw
 * journal lines per run so cost can be summed from `backend.usage` events.
 */
export function computeStats(
  records: RunRecord[],
  journalForRun: (runId: string) => string[],
): PresetStats[] {
  const byPreset = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = record.preset || "(unknown)";
    const bucket = byPreset.get(key) ?? [];
    bucket.push(record);
    byPreset.set(key, bucket);
  }
  const stats: PresetStats[] = [];
  for (const [preset, runs] of byPreset) {
    const running = runs.filter((r) => r.status === "running");
    const completed = runs.filter((r) => r.status === "completed");
    const failed = runs.filter(
      (r) => r.status === "failed" || r.status === "timed_out",
    );
    const stopped = runs.filter((r) => r.status === "stopped");
    const finished = runs.length - running.length;
    // A run is gate-verified when its persisted outcome says so; fall back to
    // `status === "completed"` for records written before the outcome ledger.
    const verified = runs.filter((r) =>
      r.outcome ? r.outcome === "verified" : r.status === "completed",
    );
    let costUsd = 0;
    for (const run of runs) {
      // Prefer the persisted cost; re-derive from the journal for old records.
      costUsd +=
        typeof run.cost_usd === "number"
          ? run.cost_usd
          : collectUsage(journalForRun(run.run_id), run.run_id).totals.costUsd;
    }
    const finishedRuns = runs.filter((r) => r.status !== "running");
    stats.push({
      preset,
      runs: runs.length,
      running: running.length,
      completed: completed.length,
      failed: failed.length,
      stopped: stopped.length,
      verified: verified.length,
      successRate: finished > 0 ? completed.length / finished : null,
      avgIterations: average(finishedRuns.map((r) => r.iteration)),
      avgDurationS: average(
        finishedRuns
          .map((r) => durationSeconds(r))
          .filter((d): d is number => d !== null),
      ),
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      costPerVerified:
        verified.length > 0
          ? Math.round((costUsd / verified.length) * 1e6) / 1e6
          : null,
    });
  }
  stats.sort((a, b) => b.runs - a.runs || a.preset.localeCompare(b.preset));
  return stats;
}

export function renderStats(projectDir: string, stats: PresetStats[]): string {
  if (stats.length === 0) {
    return `No runs recorded yet for ${projectDir}. Start one with \`autoloop run <preset>\`.`;
  }
  const header = [
    "preset",
    "runs",
    "ok",
    "verified",
    "fail",
    "stop",
    "live",
    "success",
    "avg_iters",
    "avg_secs",
    "cost_usd",
    "cost/verified",
  ];
  const rows = stats.map((s) => [
    s.preset,
    String(s.runs),
    String(s.completed),
    String(s.verified),
    String(s.failed),
    String(s.stopped),
    String(s.running),
    s.successRate === null ? "-" : `${Math.round(s.successRate * 100)}%`,
    s.avgIterations === null ? "-" : s.avgIterations.toFixed(1),
    s.avgDurationS === null ? "-" : String(Math.round(s.avgDurationS)),
    s.costUsd > 0 ? s.costUsd.toFixed(4) : "-",
    s.costPerVerified === null ? "-" : s.costPerVerified.toFixed(4),
  ]);
  const totalRuns = stats.reduce((acc, s) => acc + s.runs, 0);
  const totalCost = stats.reduce((acc, s) => acc + s.costUsd, 0);
  const lines = alignColumns([header, ...rows]);
  return [
    `## Run stats — ${projectDir}`,
    "",
    ...lines,
    "",
    `totals: ${totalRuns} run(s) across ${stats.length} preset(s)` +
      (totalCost > 0 ? `, $${totalCost.toFixed(4)} journaled cost` : ""),
  ].join("\n");
}

function durationSeconds(record: RunRecord): number | null {
  const start = Date.parse(record.created_at);
  const end = Date.parse(record.updated_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 1000;
}

function average(values: number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((acc, v) => acc + v, 0) / usable.length;
}

function alignColumns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd(),
  );
}

function printStatsUsage(): void {
  console.log("Usage: autoloop stats [project-dir] [--json]");
  console.log("");
  console.log("Per-preset analytics across all recorded runs: completion");
  console.log("counts, success rate, average iterations and duration, and");
  console.log("total journaled cost (for backends that report usage).");
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
