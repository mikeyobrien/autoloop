/**
 * Run-health classification: bucket `RunRecord`s into active / watching /
 * stuck / recently-failed / recently-completed based on preset-specific
 * age thresholds.
 *
 * Pure-ish — reads the registry via `readMergedRegistry` but otherwise is
 * a deterministic function of (records, nowMs). Used by the CLI `loops
 * health` command and the dashboard API.
 */

import { isProcessAlive } from "./helpers.js";
import { readMergedRegistry } from "./registry/discover.js";
import type { RunRecord } from "./registry/types.js";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SupervisionPolicy {
  label: string;
  warningAfterMs: number;
  stuckAfterMs: number;
}

const DEFAULT_POLICY: SupervisionPolicy = {
  label: "default",
  warningAfterMs: 5 * 60 * 1000,
  stuckAfterMs: 10 * 60 * 1000,
};

const POLICIES: Record<string, SupervisionPolicy> = {
  autospec: {
    label: "autospec",
    warningAfterMs: 10 * 60 * 1000,
    stuckAfterMs: 20 * 60 * 1000,
  },
  autocode: {
    label: "autocode",
    warningAfterMs: 5 * 60 * 1000,
    stuckAfterMs: 12 * 60 * 1000,
  },
  autosimplify: {
    label: "autosimplify",
    warningAfterMs: 2 * 60 * 1000,
    stuckAfterMs: 6 * 60 * 1000,
  },
  autoqa: {
    label: "autoqa",
    warningAfterMs: 6 * 60 * 1000,
    stuckAfterMs: 15 * 60 * 1000,
  },
  autofix: {
    label: "autofix",
    warningAfterMs: 4 * 60 * 1000,
    stuckAfterMs: 10 * 60 * 1000,
  },
  autopr: {
    label: "autopr",
    warningAfterMs: 3 * 60 * 1000,
    stuckAfterMs: 8 * 60 * 1000,
  },
};

export function policyForPreset(preset: string): SupervisionPolicy {
  return POLICIES[preset] ?? DEFAULT_POLICY;
}

export interface HealthResult {
  active: RunRecord[];
  watching: RunRecord[];
  stuck: RunRecord[];
  recentFailed: RunRecord[];
  recentCompleted: RunRecord[];
}

/** Read the merged registry and classify all records. */
export function categorizeRuns(stateDir: string): HealthResult {
  const all = readMergedRegistry(stateDir);
  return categorizeRecords(all);
}

/**
 * Pure bucket-assignment over a list of records. Exposed for callers that
 * already hold registry data (tests, dashboard bulk ops).
 */
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

function isRecent(r: RunRecord, nowMs: number): boolean {
  if (!r.updated_at) return false;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return nowMs - updatedMs <= RECENT_WINDOW_MS;
}
