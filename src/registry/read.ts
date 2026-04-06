import { existsSync, readFileSync } from "node:fs";
import type { RunRecord } from "./types.js";

export function readRegistry(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  const entries = new Map<string, RunRecord>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as RunRecord;
      if (record.run_id) entries.set(record.run_id, record);
    } catch {
      // skip malformed lines
    }
  }
  return Array.from(entries.values());
}

export function getRun(path: string, runId: string): RunRecord | undefined {
  return readRegistry(path).find((r) => r.run_id === runId);
}

export function activeRuns(path: string): RunRecord[] {
  return readRegistry(path).filter((r) => r.status === "running");
}

export function recentRuns(path: string, limit: number): RunRecord[] {
  const all = readRegistry(path);
  all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all.slice(0, limit);
}

/**
 * Find a run by exact or prefix match.
 * Returns the matched record, or an array of candidates if ambiguous.
 * Returns undefined if no match.
 */
export function findRunByPrefix(
  path: string,
  partial: string,
): RunRecord | RunRecord[] | undefined {
  const all = readRegistry(path);
  const exact = all.find((r) => r.run_id === partial);
  if (exact) return exact;
  const matches = all.filter((r) => r.run_id.startsWith(partial));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches;
  return undefined;
}
