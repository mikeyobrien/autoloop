import { basename, dirname, join } from "node:path";

/**
 * Resolve the run-scoped control directory.
 *
 * `runStateDir` is the per-run state tree:
 *   - run-scoped mode: <base>/.autoloop/runs/<run-id>/
 *   - worktree mode:   <worktree>/.autoloop/
 *   - shared mode:     <base>/.autoloop/runs/<run-id>/ (same as run-scoped)
 *
 * The registry record's `state_dir` is always the right input.
 */
export function controlDir(runStateDir: string): string {
  return join(runStateDir, "control");
}

export function controlRequestsFile(runStateDir: string): string {
  return join(controlDir(runStateDir), "requests.jsonl");
}

export function controlStatusFile(runStateDir: string): string {
  return join(controlDir(runStateDir), "status.jsonl");
}

export function controlCapabilitiesFile(runStateDir: string): string {
  return join(controlDir(runStateDir), "capabilities.json");
}

/**
 * Infer the base state dir given a run's recorded state_dir. Used to find the
 * parent state-dir registry when the run dir is a per-run or worktree tree.
 *
 * State-dir-name agnostic (works for any `core.state_dir`, including nested
 * roots like `.ralph/autoloop`): a run-scoped tree always lives at
 * `<base>/runs/<run-id>/`, so it's identified by its parent directory being
 * named `runs`. Anything else (worktree/shared root) is already the base.
 */
export function baseStateDirFromRunState(runStateDir: string): string {
  // run-scoped/shared: <base>/runs/<run-id>/ -> peel `runs/<run-id>`.
  if (basename(dirname(runStateDir)) === "runs") {
    return dirname(dirname(runStateDir));
  }
  // worktree: <work>/<state-dir>/ -> runStateDir itself is the base.
  return runStateDir;
}
