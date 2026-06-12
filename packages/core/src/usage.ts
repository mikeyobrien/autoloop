// Usage and cost aggregation over journal `backend.usage` events.
//
// Backends that report token telemetry (the pi RPC backend today) journal one
// `backend.usage` fields event per iteration. These helpers materialize that
// stream into per-iteration rows and run totals so budget enforcement,
// `inspect usage`, and `stats` all read from the same journal-derived source
// of truth instead of keeping a parallel counter in memory.

import { decodeEvent } from "./events/decode.js";

export interface UsageRow {
  iteration: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  contextPercent?: number;
}

export interface UsageTotals {
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface RunUsage {
  rows: UsageRow[];
  totals: UsageTotals;
}

export function emptyUsageTotals(): UsageTotals {
  return {
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

/**
 * Aggregate `backend.usage` events from raw journal lines.
 * When `runId` is given, only events for that run are considered.
 */
export function collectUsage(lines: string[], runId?: string): RunUsage {
  const rows: UsageRow[] = [];
  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event || event.shape !== "fields") continue;
    if (event.topic !== "backend.usage") continue;
    if (runId && event.run !== runId) continue;
    const row: UsageRow = {
      iteration: event.iteration ?? "",
      inputTokens: parseNum(event.fields.input_tokens),
      outputTokens: parseNum(event.fields.output_tokens),
      cacheReadTokens: parseNum(event.fields.cache_read_tokens),
      cacheWriteTokens: parseNum(event.fields.cache_write_tokens),
      totalTokens: parseNum(event.fields.total_tokens),
      costUsd: parseNum(event.fields.cost_usd),
    };
    if (event.fields.context_percent !== undefined) {
      row.contextPercent = parseNum(event.fields.context_percent);
    }
    rows.push(row);
  }
  const totals = rows.reduce((acc, row) => {
    acc.iterations += 1;
    acc.inputTokens += row.inputTokens;
    acc.outputTokens += row.outputTokens;
    acc.cacheReadTokens += row.cacheReadTokens;
    acc.cacheWriteTokens += row.cacheWriteTokens;
    acc.totalTokens += row.totalTokens;
    acc.costUsd += row.costUsd;
    return acc;
  }, emptyUsageTotals());
  totals.costUsd = roundCost(totals.costUsd);
  return { rows, totals };
}

/** Render usage as JSON or an aligned terminal/markdown table. */
export function formatUsage(usage: RunUsage, format: string): string {
  if (format === "json") {
    return JSON.stringify(usage, null, 2);
  }
  if (usage.rows.length === 0) {
    return [
      "No backend usage telemetry recorded for this run.",
      "(Token and cost stats are reported by backends with usage support — the claude-sdk and pi backends today.)",
    ].join("\n");
  }
  const header = [
    "iter",
    "input",
    "output",
    "cache_r",
    "cache_w",
    "total",
    "cost_usd",
    "ctx%",
  ];
  const body = usage.rows.map((r) => [
    r.iteration || "-",
    String(r.inputTokens),
    String(r.outputTokens),
    String(r.cacheReadTokens),
    String(r.cacheWriteTokens),
    String(r.totalTokens),
    r.costUsd.toFixed(4),
    r.contextPercent === undefined ? "-" : String(r.contextPercent),
  ]);
  const table = alignColumns([header, ...body]);
  const t = usage.totals;
  const summary = `totals: ${t.iterations} iteration(s), ${t.totalTokens} tokens, $${t.costUsd.toFixed(4)}`;
  return ["## Usage", "", ...table, "", summary].join("\n");
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

function parseNum(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Avoid float-noise like 0.30000000000000004 in summed costs. */
function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
