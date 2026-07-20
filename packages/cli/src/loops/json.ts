import {
  mergedActiveRuns,
  mergedFindRunByPrefix,
  readMergedRegistry,
} from "@mobrienv/autoloop-core/registry/discover";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import {
  categorizeRecords,
  categorizeRuns,
  reapStaleRuns,
} from "@mobrienv/autoloop-core/runs-health";

/** Result of a JSON command: text to print plus desired exit code. */
export interface JsonResult {
  output: string;
  exitCode: number;
}

/**
 * Project a run record down to the fields the list table shows.
 * Worktree fields are only included when present.
 */
export function runSummary(r: RunRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    run_id: r.run_id,
    status: r.status,
    preset: r.preset,
    iteration: r.iteration,
    max_iterations: r.max_iterations,
    stop_reason: r.stop_reason,
    latest_event: r.latest_event,
    created_at: r.created_at,
    updated_at: r.updated_at,
    isolation_mode: r.isolation_mode,
  };
  if (r.worktree_name) out.worktree_name = r.worktree_name;
  if (r.worktree_path) out.worktree_path = r.worktree_path;
  if (r.worktree_merged !== undefined) out.worktree_merged = r.worktree_merged;
  if (r.worktree_merged_at != null)
    out.worktree_merged_at = r.worktree_merged_at;
  if (r.worktree_merge_strategy)
    out.worktree_merge_strategy = r.worktree_merge_strategy;
  return out;
}

/**
 * JSON equivalent of listRuns: array of run summaries.
 * Mirrors the same selection/ordering as the human table.
 */
export function listRunsJson(
  stateDir: string,
  all: boolean,
  stateDirRelativePath?: string,
): string {
  const runs = all
    ? readMergedRegistry(stateDir, stateDirRelativePath).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      )
    : mergedActiveRuns(stateDir, stateDirRelativePath);
  return JSON.stringify(runs.map(runSummary), null, 2);
}

/**
 * JSON equivalent of showRun: the full RunRecord plus a derived
 * `health` bucket. Unknown/ambiguous ids produce an error object
 * and exit code 1.
 */
export function showRunJson(
  stateDir: string,
  partial: string,
  stateDirRelativePath?: string,
): JsonResult {
  const result = mergedFindRunByPrefix(stateDir, partial, stateDirRelativePath);

  if (result === undefined) {
    return {
      output: JSON.stringify(
        { error: `No run matching '${partial}'.` },
        null,
        2,
      ),
      exitCode: 1,
    };
  }

  if (Array.isArray(result)) {
    return {
      output: JSON.stringify(
        {
          error: `Ambiguous run ID '${partial}'.`,
          matches: result.map((r: RunRecord) => r.run_id),
        },
        null,
        2,
      ),
      exitCode: 1,
    };
  }

  return {
    output: JSON.stringify(
      { ...result, health: healthBucketFor(result) },
      null,
      2,
    ),
    exitCode: 0,
  };
}

/**
 * JSON equivalent of showArtifacts: artifact paths for a run.
 */
export function artifactsJson(
  stateDir: string,
  partial: string,
  stateDirRelativePath?: string,
): JsonResult {
  const result = mergedFindRunByPrefix(stateDir, partial, stateDirRelativePath);

  if (result === undefined) {
    return {
      output: JSON.stringify(
        { error: `No run matching '${partial}'.` },
        null,
        2,
      ),
      exitCode: 1,
    };
  }

  if (Array.isArray(result)) {
    return {
      output: JSON.stringify(
        {
          error: `Ambiguous run ID '${partial}'.`,
          matches: result.map((r: RunRecord) => r.run_id),
        },
        null,
        2,
      ),
      exitCode: 1,
    };
  }

  return {
    output: JSON.stringify(
      {
        run_id: result.run_id,
        journal_file: result.journal_file,
        state_dir: result.state_dir || stateDir,
        work_dir: result.work_dir,
      },
      null,
      2,
    ),
    exitCode: 0,
  };
}

/**
 * JSON equivalent of healthSummary: every bucket with counts and run ids.
 * The JSON form always includes all buckets (verbose has no effect).
 *
 * Reaps stale runs first so the health snapshot reflects reality.
 */
export function healthJson(
  stateDir: string,
  stateDirRelativePath?: string,
): string {
  reapStaleRuns(stateDir, stateDirRelativePath);
  const h = categorizeRuns(stateDir, stateDirRelativePath);
  const bucket = (runs: RunRecord[]) => ({
    count: runs.length,
    run_ids: runs.map((r) => r.run_id),
  });
  return JSON.stringify(
    {
      active: bucket(h.active),
      watching: bucket(h.watching),
      stuck: bucket(h.stuck),
      recent_failed: bucket(h.recentFailed),
      recent_completed: bucket(h.recentCompleted),
    },
    null,
    2,
  );
}

/**
 * Derive the health bucket a single record falls into, or null when it
 * lands outside every bucket (e.g. finished more than 24h ago).
 * Categorization runs on a copy so the reported record is never mutated.
 */
function healthBucketFor(r: RunRecord): string | null {
  const h = categorizeRecords([{ ...r }]);
  if (h.stuck.length > 0) return "stuck";
  if (h.watching.length > 0) return "watching";
  if (h.active.length > 0) return "active";
  if (h.recentFailed.length > 0) return "recent_failed";
  if (h.recentCompleted.length > 0) return "recent_completed";
  return null;
}
