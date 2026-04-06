import { readMergedRegistry } from "../registry/discover.js";
import type { RunRecord } from "../registry/types.js";
import { policyForPreset } from "./policy.js";
import { renderListHeader, renderRunLine } from "./render.js";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface HealthResult {
  active: RunRecord[];
  watching: RunRecord[];
  stuck: RunRecord[];
  recentFailed: RunRecord[];
  recentCompleted: RunRecord[];
}

/**
 * Produce a health summary string from the registry.
 * Exception-focused: only surfaces issues by default.
 * Pass verbose=true to also list recent completions.
 */
export function healthSummary(stateDir: string, verbose: boolean): string {
  const result = categorizeRuns(stateDir);
  return renderHealth(result, verbose);
}

export function categorizeRuns(stateDir: string): HealthResult {
  const all = readMergedRegistry(stateDir);
  return categorizeRecords(all);
}

export function categorizeRecords(
  records: RunRecord[],
  nowMs: number = Date.now(),
): HealthResult {
  const active: RunRecord[] = [];
  const watching: RunRecord[] = [];
  const stuck: RunRecord[] = [];
  const recentFailed: RunRecord[] = [];
  const recentCompleted: RunRecord[] = [];

  for (const r of records) {
    if (r.status === "running") {
      // If PID is recorded and the process is dead, treat as stopped
      if (r.pid != null && !isProcessAlive(r.pid)) {
        r.status = "stopped";
        r.stop_reason = r.stop_reason || "interrupted";
        // Fall through to non-running classification
      } else {
        const elapsed = elapsedMs(r, nowMs);
        if (elapsed === null) {
          active.push(r);
          continue;
        }
        const policy = policyForPreset(r.preset);
        if (elapsed > policy.stuckAfterMs) {
          stuck.push(r);
        } else if (elapsed > policy.warningAfterMs) {
          watching.push(r);
        } else {
          active.push(r);
        }
        continue;
      }
    }

    if (!isRecent(r, nowMs)) continue;

    if (r.status === "failed" || r.status === "timed_out") {
      recentFailed.push(r);
    } else if (r.status === "completed") {
      recentCompleted.push(r);
    }
  }

  return { active, watching, stuck, recentFailed, recentCompleted };
}

function elapsedMs(r: RunRecord, nowMs: number): number | null {
  if (!r.updated_at) return null;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return null;
  return nowMs - updatedMs;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecent(r: RunRecord, nowMs: number): boolean {
  if (!r.updated_at) return false;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return nowMs - updatedMs <= RECENT_WINDOW_MS;
}

function renderHealth(h: HealthResult, verbose: boolean): string {
  const hasExceptions =
    h.stuck.length > 0 || h.recentFailed.length > 0 || h.watching.length > 0;

  if (!hasExceptions && h.active.length === 0) {
    return (
      "All clear. 0 active, " +
      h.recentCompleted.length +
      " completed in last 24h."
    );
  }

  if (!hasExceptions) {
    return (
      "All clear. " +
      h.active.length +
      " active, " +
      h.recentCompleted.length +
      " completed in last 24h."
    );
  }

  const lines: string[] = [];

  lines.push(
    "Health: " +
      h.active.length +
      " active, " +
      h.watching.length +
      " watching, " +
      h.stuck.length +
      " stuck, " +
      h.recentFailed.length +
      " failed (last 24h)",
  );
  lines.push("");

  if (h.stuck.length > 0) {
    lines.push("STUCK:");
    lines.push(renderListHeader());
    for (const r of h.stuck) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.watching.length > 0) {
    lines.push("WATCHING:");
    lines.push(renderListHeader());
    for (const r of h.watching) lines.push(renderRunLine(r));
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
