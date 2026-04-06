import { readMergedRegistry, mergedActiveRuns } from "../registry/discover.js";
import { renderRunLine, renderListHeader } from "./render.js";

/**
 * List runs from the merged registry (root + chain/worktree children).
 * When `all` is false, only active (running) runs are shown.
 * When `all` is true, all runs are shown sorted by updated_at descending.
 */
export function listRuns(stateDir: string, all: boolean): string {
  const runs = all
    ? readMergedRegistry(stateDir).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    : mergedActiveRuns(stateDir);

  if (runs.length === 0) {
    return all ? "No runs found." : "No active runs.";
  }

  const lines = [renderListHeader()];
  for (const r of runs) {
    lines.push(renderRunLine(r));
  }
  return lines.join("\n");
}
