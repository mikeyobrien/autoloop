import type { RunRecord } from "../registry/types.js";

export type IsolationMode = "shared" | "run-scoped" | "worktree";

export interface IsolationRequest {
  worktree?: boolean;
  noWorktree?: boolean;
  configEnabled?: boolean;
}

export interface IsolationResult {
  mode: IsolationMode;
  warning?: string;
}

/**
 * Decide the isolation mode for a new run based on CLI flags,
 * config, and the state of currently active runs.
 *
 * Priority:
 *  1. Explicit --worktree flag → "worktree"
 *  2. Explicit --no-worktree flag → "shared"
 *  3. Config isolation.enabled → "worktree"
 *  4. Other active runs exist with code roles → "run-scoped" + warning
 *  5. Other active runs exist (non-code) → "run-scoped"
 *  6. Solo run → "shared"
 */
export function resolveIsolationMode(
  request: IsolationRequest,
  otherActiveRuns: RunRecord[],
): IsolationResult {
  if (request.worktree) {
    return { mode: "worktree" };
  }

  if (request.noWorktree) {
    return { mode: "shared" };
  }

  if (request.configEnabled) {
    return { mode: "worktree" };
  }

  if (otherActiveRuns.length === 0) {
    return { mode: "shared" };
  }

  const hasCodeRuns = otherActiveRuns.some((r) => isCodeModifyingRun(r));
  if (hasCodeRuns) {
    return {
      mode: "run-scoped",
      warning: "concurrent code-modifying run detected; using run-scoped isolation",
    };
  }

  return { mode: "run-scoped" };
}

/**
 * Heuristic: a run is "code-modifying" if its preset or objective
 * suggests it writes code (builder, autocode, fix, etc.).
 * This is intentionally conservative — returns false when uncertain.
 */
export function isCodeModifyingRun(record: RunRecord): boolean {
  const preset = record.preset.toLowerCase();
  const objective = record.objective.toLowerCase();
  const codeIndicators = ["autocode", "builder", "fix", "implement", "refactor", "code"];
  return codeIndicators.some((ind) => preset.includes(ind) || objective.includes(ind));
}
