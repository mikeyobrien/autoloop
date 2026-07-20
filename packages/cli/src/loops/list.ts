import {
  mergedActiveRuns,
  readMergedRegistry,
} from "@mobrienv/autoloop-core/registry/discover";
import { renderListHeader, renderRunLine } from "./render.js";

/**
 * List runs from the merged registry (root + chain/worktree children).
 * When `all` is false, only active (running) runs are shown.
 * When `all` is true, all runs are shown sorted by updated_at descending.
 */
export function listRuns(
  stateDir: string,
  all: boolean,
  stateDirRelativePath?: string,
): string {
  const runs = all
    ? readMergedRegistry(stateDir, stateDirRelativePath).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      )
    : mergedActiveRuns(stateDir, stateDirRelativePath);

  if (runs.length === 0) {
    return all ? "No runs found." : "No active runs.";
  }

  const lines = [renderListHeader()];
  for (const r of runs) {
    lines.push(renderRunLine(r));
  }
  return lines.join("\n");
}
