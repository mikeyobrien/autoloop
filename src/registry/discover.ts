import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readRegistry } from "./read.js";
import type { RunRecord } from "./types.js";

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/**
 * Discover chain and worktree registry files under the given state directory.
 * Walks chains/{id}/step-{n}/.autoloop/ for registry.jsonl files,
 * including worktree-isolated registries nested further below.
 */
export function discoverChainRegistries(stateDir: string): string[] {
  const results: string[] = [];
  const chainsDir = join(stateDir, "chains");
  for (const chainDir of listDirs(chainsDir)) {
    for (const stepDir of listDirs(chainDir)) {
      if (!stepDir.includes("step-")) continue;
      const stepState = join(stepDir, ".autoloop");
      // Direct chain step registry
      const regPath = join(stepState, "registry.jsonl");
      if (existsSync(regPath)) results.push(regPath);
      // Worktree-isolated registries under this step
      const wtDir = join(stepState, "worktrees");
      for (const wtRunDir of listDirs(wtDir)) {
        const wtReg = join(wtRunDir, "tree", ".autoloop", "registry.jsonl");
        if (existsSync(wtReg)) results.push(wtReg);
      }
    }
  }
  return results;
}

/**
 * Merge records from multiple registries, deduplicating by run_id.
 * The record with the most recent updated_at wins.
 */
function mergeRecords(recordSets: RunRecord[][]): RunRecord[] {
  const map = new Map<string, RunRecord>();
  for (const records of recordSets) {
    for (const r of records) {
      const existing = map.get(r.run_id);
      if (!existing || r.updated_at > existing.updated_at) {
        map.set(r.run_id, r);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Read the root registry plus all discovered chain/worktree registries,
 * returning a deduplicated merged view.
 */
export function readMergedRegistry(stateDir: string): RunRecord[] {
  const rootPath = join(stateDir, "registry.jsonl");
  const childPaths = discoverChainRegistries(stateDir);
  const recordSets = [readRegistry(rootPath)];
  for (const p of childPaths) {
    recordSets.push(readRegistry(p));
  }
  return mergeRecords(recordSets);
}

/** Active runs from the merged registry view. */
export function mergedActiveRuns(stateDir: string): RunRecord[] {
  return readMergedRegistry(stateDir).filter((r) => r.status === "running");
}

/** Recent runs from the merged registry view, sorted by updated_at desc. */
export function mergedRecentRuns(stateDir: string, limit: number): RunRecord[] {
  const all = readMergedRegistry(stateDir);
  all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all.slice(0, limit);
}

/**
 * Find a run by exact or prefix match across the merged registry.
 */
export function mergedFindRunByPrefix(
  stateDir: string,
  partial: string,
): RunRecord | RunRecord[] | undefined {
  const all = readMergedRegistry(stateDir);
  const exact = all.find((r) => r.run_id === partial);
  if (exact) return exact;
  const matches = all.filter((r) => r.run_id.startsWith(partial));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches;
  return undefined;
}
