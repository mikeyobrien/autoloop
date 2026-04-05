import { mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Create a run-scoped state directory under `.autoloop/runs/<runId>/`.
 * Returns the absolute path to the created directory.
 */
export function createRunScopedDir(baseStateDir: string, runId: string): string {
  const dir = runScopedPath(baseStateDir, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Compute the run-scoped path without creating it.
 */
export function runScopedPath(baseStateDir: string, runId: string): string {
  return join(baseStateDir, "runs", runId);
}

/**
 * Clean up run-scoped directories for runs that have reached a terminal state.
 * Keeps directories for runs that are still active.
 */
export function cleanRunScopedDirs(
  baseStateDir: string,
  activeRunIds: Set<string>,
): string[] {
  const runsDir = join(baseStateDir, "runs");
  if (!existsSync(runsDir)) return [];

  const removed: string[] = [];
  for (const entry of readdirSync(runsDir)) {
    if (activeRunIds.has(entry)) continue;
    const fullPath = join(runsDir, entry);
    rmSync(fullPath, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
