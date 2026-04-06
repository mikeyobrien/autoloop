import { mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
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

export interface CleanRunScopedOpts {
  /** Skip directories for runs that are still active. */
  activeRunIds: Set<string>;
  /** Only remove directories older than this many days. 0 = no age filter. Default: 0. */
  maxAgeDays?: number;
}

/**
 * Clean up run-scoped directories for runs that have reached a terminal state.
 * Keeps directories for runs that are still active.
 * When maxAgeDays > 0, also keeps directories modified within the threshold.
 */
export function cleanRunScopedDirs(
  baseStateDir: string,
  opts: CleanRunScopedOpts,
): string[] {
  const runsDir = join(baseStateDir, "runs");
  if (!existsSync(runsDir)) return [];

  const { activeRunIds, maxAgeDays = 0 } = opts;
  const now = Date.now();
  const thresholdMs = maxAgeDays > 0 ? maxAgeDays * 86_400_000 : 0;

  const removed: string[] = [];
  for (const entry of readdirSync(runsDir)) {
    if (activeRunIds.has(entry)) continue;
    const fullPath = join(runsDir, entry);

    if (thresholdMs > 0) {
      try {
        const mtime = statSync(fullPath).mtimeMs;
        if (now - mtime < thresholdMs) continue;
      } catch { continue; }
    }

    rmSync(fullPath, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
