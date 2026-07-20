import { join } from "node:path";
import * as config from "@mobrienv/autoloop-core/config";

export interface IssueSyncPathEnv {
  AUTOLOOP_BASE_STATE_DIR?: string;
  AUTOLOOP_STATE_DIR?: string;
  AUTOLOOP_TASKS_FILE?: string;
}

export interface IssueSyncPaths {
  /** Shared top-level state root containing issue-sync config and ledger. */
  stateDir: string;
  configFile: string;
  stateFile: string;
  /** Run-local task queue when supplied by the harness. */
  tasksFile: string;
}

/**
 * Resolve issue-sync paths using Autoloop's real layered config loader.
 *
 * Precedence for the shared issue-sync state root:
 * 1. `AUTOLOOP_BASE_STATE_DIR` (the harness hook contract)
 * 2. `AUTOLOOP_STATE_DIR` (a standalone issue-sync top-level override)
 * 3. layered `core.state_dir`
 * 4. `.autoloop`
 *
 * `AUTOLOOP_STATE_DIR` normally names an active run's possibly run-scoped
 * state. Harness hooks therefore also receive `AUTOLOOP_BASE_STATE_DIR`, which
 * wins and keeps the issue-sync config/ledger shared across runs. A standalone
 * issue-sync invocation that supplies only `AUTOLOOP_STATE_DIR` explicitly
 * opts into treating it as the top-level issue-sync root.
 *
 * The task queue independently prefers `AUTOLOOP_TASKS_FILE`. Without it, an
 * explicit `core.tasks_file` wins; otherwise tasks derive from the effective
 * runtime/configured state root.
 */
export function resolveIssueSyncPaths(
  projectDir: string,
  env: IssueSyncPathEnv = process.env,
): IssueSyncPaths {
  const runtimeStateDir =
    env.AUTOLOOP_BASE_STATE_DIR || env.AUTOLOOP_STATE_DIR || undefined;
  const runtimeEnv = {
    AUTOLOOP_STATE_DIR: runtimeStateDir,
    AUTOLOOP_TASKS_FILE: env.AUTOLOOP_TASKS_FILE,
  };
  const loadOptions = { workDir: projectDir };
  const stateDir = config.stateDirPath(projectDir, runtimeEnv, loadOptions);
  const tasksFile = config.resolveTasksFile(
    projectDir,
    runtimeEnv,
    loadOptions,
  );

  return {
    stateDir,
    configFile: join(stateDir, "issue-sync.toml"),
    stateFile: join(stateDir, "issue-sync-state.json"),
    tasksFile,
  };
}
