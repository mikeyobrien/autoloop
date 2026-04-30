import {
  categorizeRuns,
  type HealthResult,
} from "@mobrienv/autoloop-core/runs-health";
import { renderListHeader, renderRunLine } from "./render.js";

export {
  categorizeRecords,
  categorizeRuns,
  type HealthResult,
  policyForPreset,
  type SupervisionPolicy,
} from "@mobrienv/autoloop-core/runs-health";

/**
 * Produce a health summary string from the registry.
 * Exception-focused: only surfaces issues by default.
 * Pass verbose=true to also list recent completions.
 */
export function healthSummary(stateDir: string, verbose: boolean): string {
  const result = categorizeRuns(stateDir);
  return renderHealth(result, verbose);
}

function renderHealth(h: HealthResult, verbose: boolean): string {
  const hasExceptions =
    h.stuck.length > 0 || h.recentFailed.length > 0 || h.watching.length > 0;

  if (!hasExceptions && h.active.length === 0) {
    return (
      "All clear. 0 active, " +
      h.recentCompleted.length +
      " completed in last 24h."
    );
  }

  if (!hasExceptions) {
    return (
      "All clear. " +
      h.active.length +
      " active, " +
      h.recentCompleted.length +
      " completed in last 24h."
    );
  }

  const lines: string[] = [];

  lines.push(
    "Health: " +
      h.active.length +
      " active, " +
      h.watching.length +
      " watching, " +
      h.stuck.length +
      " stuck, " +
      h.recentFailed.length +
      " failed (last 24h)",
  );
  lines.push("");

  if (h.stuck.length > 0) {
    lines.push("STUCK:");
    lines.push(renderListHeader());
    for (const r of h.stuck) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.watching.length > 0) {
    lines.push("WATCHING:");
    lines.push(renderListHeader());
    for (const r of h.watching) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.recentFailed.length > 0) {
    lines.push("FAILED:");
    lines.push(renderListHeader());
    for (const r of h.recentFailed) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (h.active.length > 0) {
    lines.push("ACTIVE:");
    lines.push(renderListHeader());
    for (const r of h.active) lines.push(renderRunLine(r));
    lines.push("");
  }

  if (verbose && h.recentCompleted.length > 0) {
    lines.push("COMPLETED (last 24h):");
    lines.push(renderListHeader());
    for (const r of h.recentCompleted) lines.push(renderRunLine(r));
    lines.push("");
  }

  // Trim trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}
