import { mergedFindRunByPrefix } from "@mobrienv/autoloop-core/registry/discover";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { renderArtifacts, renderRunDetail } from "./render.js";

/**
 * Show detail view for a run by exact or partial ID.
 */
export function showRun(stateDir: string, partial: string): string {
  const result = mergedFindRunByPrefix(stateDir, partial);

  if (result === undefined) {
    return `No run matching '${partial}'.`;
  }

  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => `  ${r.run_id}`).join("\n");
    return `Ambiguous run ID '${partial}'. Matches:\n${ids}`;
  }

  return renderRunDetail(result);
}

/**
 * Show artifact paths for a run by exact or partial ID.
 */
export function showArtifacts(stateDir: string, partial: string): string {
  const result = mergedFindRunByPrefix(stateDir, partial);

  if (result === undefined) {
    return `No run matching '${partial}'.`;
  }

  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => `  ${r.run_id}`).join("\n");
    return `Ambiguous run ID '${partial}'. Matches:\n${ids}`;
  }

  return renderArtifacts(result, stateDir);
}
