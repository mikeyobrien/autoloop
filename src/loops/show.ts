import { findRunByPrefix } from "../registry/read.js";
import type { RunRecord } from "../registry/types.js";
import { renderRunDetail, renderArtifacts } from "./render.js";

/**
 * Show detail view for a run by exact or partial ID.
 */
export function showRun(registryPath: string, partial: string): string {
  const result = findRunByPrefix(registryPath, partial);

  if (result === undefined) {
    return "No run matching '" + partial + "'.";
  }

  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => "  " + r.run_id).join("\n");
    return "Ambiguous run ID '" + partial + "'. Matches:\n" + ids;
  }

  return renderRunDetail(result);
}

/**
 * Show artifact paths for a run by exact or partial ID.
 */
export function showArtifacts(registryPath: string, partial: string): string {
  const result = findRunByPrefix(registryPath, partial);

  if (result === undefined) {
    return "No run matching '" + partial + "'.";
  }

  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => "  " + r.run_id).join("\n");
    return "Ambiguous run ID '" + partial + "'. Matches:\n" + ids;
  }

  return renderArtifacts(result, registryPath);
}
