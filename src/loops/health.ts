import { readRegistry } from "../registry/read.js";
import type { RunRecord } from "../registry/types.js";
import { renderRunLine, renderListHeader } from "./render.js";

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HealthResult {
  active: RunRecord[];
  stuck: RunRecord[];
  recentFailed: RunRecord[];
  recentCompleted: RunRecord[];
}

/**
 * Produce a health summary string from the registry.
 * Exception-focused: only surfaces issues by default.
 * Pass verbose=true to also list recent completions.
 */
export function healthSummary(registryPath: string, verbose: boolean): string {
  const result = categorizeRuns(registryPath);
  return renderHealth(result, verbose);
}

export function categorizeRuns(registryPath: string): HealthResult {
  const now = Date.now();
  const all = readRegistry(registryPath);

  const active: RunRecord[] = [];
  const stuck: RunRecord[] = [];
  const recentFailed: RunRecord[] = [];
  const recentCompleted: RunRecord[] = [];

  for (const r of all) {
    if (r.status === "running") {
      if (isStuck(r, now)) {
        stuck.push(r);
      } else {
        active.push(r);
      }
      continue;
    }

    if (!isRecent(r, now)) continue;

    if (r.status === "failed" || r.status === "timed_out") {
      recentFailed.push(r);
    } else if (r.status === "completed") {
      recentCompleted.push(r);
    }
  }

  return { active, stuck, recentFailed, recentCompleted };
}

function isStuck(r: RunRecord, nowMs: number): boolean {
  if (!r.updated_at) return false;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return (nowMs - updatedMs) > STUCK_THRESHOLD_MS;
}

function isRecent(r: RunRecord, nowMs: number): boolean {
  if (!r.updated_at) return false;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return (nowMs - updatedMs) <= RECENT_WINDOW_MS;
}

function renderHealth(h: HealthResult, verbose: boolean): string {
  const hasExceptions = h.stuck.length > 0 || h.recentFailed.length > 0;

  if (!hasExceptions && h.active.length === 0) {
    return "All clear. 0 active, " + h.recentCompleted.length + " completed in last 24h.";
  }

  if (!hasExceptions) {
    return "All clear. " + h.active.length + " active, " + h.recentCompleted.length + " completed in last 24h.";
  }

  const lines: string[] = [];

  lines.push(
    "Health: " + h.active.length + " active, " +
    h.stuck.length + " stuck, " +
    h.recentFailed.length + " failed (last 24h)",
  );
  lines.push("");

  if (h.stuck.length > 0) {
    lines.push("STUCK:");
    lines.push(renderListHeader());
    for (const r of h.stuck) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.recentFailed.length > 0) {
    lines.push("FAILED:");
    lines.push(renderListHeader());
    for (const r of h.recentFailed) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.active.length > 0) {
    lines.push("ACTIVE:");
    lines.push(renderListHeader());
    for (const r of h.active) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (verbose && h.recentCompleted.length > 0) {
    lines.push("COMPLETED (last 24h):");
    lines.push(renderListHeader());
    for (const r of h.recentCompleted) lines.push(renderRunLine(r));
    lines.push("");
  }

  // Trim trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}
