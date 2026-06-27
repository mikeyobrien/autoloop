import { spawnSync } from "node:child_process";
import { jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  extractField,
  extractTopic,
} from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "./types.js";

export interface ProgressMetric {
  name: string;
  value: number;
  iteration: number;
}

/**
 * Extract the progress scalar from a metric command's stdout: the last numeric
 * token (so `tests: 42 passed` → 42, `0.87` → 0.87). Returns null when no
 * number is present.
 */
export function parseMetricValue(stdout: string): number | null {
  const matches = stdout.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run the preset-declared progress metric command HARNESS-side after an
 * iteration and journal the scalar (`progress.metric`). No-op when no metric is
 * configured or its output has no number. Returns the captured metric, or null.
 */
export function runProgressMetric(
  loop: LoopContext,
  iteration: number,
): ProgressMetric | null {
  const cmd = loop.progress?.metricCmd?.trim();
  if (!cmd) return null;
  const res = spawnSync(cmd, {
    shell: "/bin/sh",
    cwd: loop.paths.workDir,
    encoding: "utf-8",
    timeout: loop.progress?.timeoutMs ?? 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const value = parseMetricValue(`${res.stdout ?? ""}`);
  if (value === null) return null;
  const name = loop.progress?.name || "progress";
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "progress.metric",
    jsonField("name", name) + ", " + jsonFieldRaw("value", String(value)),
  );
  return { name, value, iteration };
}

/** Read the journaled progress-metric series for a run (queryable). */
export function readProgressMetrics(runLines: string[]): ProgressMetric[] {
  const out: ProgressMetric[] = [];
  for (const line of runLines) {
    if (extractTopic(line) !== "progress.metric") continue;
    const value = Number(extractField(line, "value"));
    if (!Number.isFinite(value)) continue;
    out.push({
      name: extractField(line, "name") || "progress",
      value,
      iteration: Number(extractField(line, "iteration")) || 0,
    });
  }
  return out;
}
