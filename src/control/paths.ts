import { basename, join } from "node:path";

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
 * parent `.autoloop/` registry when the run dir is a per-run or worktree tree.
 */
export function baseStateDirFromRunState(runStateDir: string): string {
  // run-scoped: <base>/runs/<run-id>/  -> parent of parent
  // worktree: <work>/.autoloop/        -> runStateDir itself is the base
  // shared:   same as run-scoped
  const parentName = basename(runStateDir);
  if (parentName === ".autoloop" || parentName === ".miniloop") {
    return runStateDir;
  }
  // runs/<run-id>/ path — peel two levels
  const runs = join(runStateDir, "..");
  return join(runs, "..");
}
