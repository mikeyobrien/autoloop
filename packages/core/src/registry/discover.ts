import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { discoverChainStepStateLayouts } from "../chain-state.js";
import { DEFAULT_STATE_DIR } from "../config-schema.js";
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
 * Each step uses its recorded child state layout. Legacy steps without metadata
 * use the default child root and parent layout as bounded fallbacks.
 */
export function discoverChainRegistries(
  stateDir: string,
  stateDirRel: string = DEFAULT_STATE_DIR,
): string[] {
  const results = new Set<string>();
  for (const layout of discoverChainStepStateLayouts(stateDir, stateDirRel)) {
    const regPath = join(layout.stateDir, "registry.jsonl");
    if (existsSync(regPath)) results.add(regPath);

    for (const wtRunDir of listDirs(join(layout.stateDir, "worktrees"))) {
      const treeDir = join(wtRunDir, "tree");
      const wtState = isAbsolute(layout.stateDirRel)
        ? layout.stateDirRel
        : join(treeDir, layout.stateDirRel);
      const wtReg = join(wtState, "registry.jsonl");
      if (existsSync(wtReg)) results.add(wtReg);
    }
  }
  return [...results];
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
export function readMergedRegistry(
  stateDir: string,
  stateDirRel: string = DEFAULT_STATE_DIR,
): RunRecord[] {
  const rootPath = join(stateDir, "registry.jsonl");
  const childPaths = discoverChainRegistries(stateDir, stateDirRel);
  const recordSets = [readRegistry(rootPath)];
  for (const p of childPaths) {
    recordSets.push(readRegistry(p));
  }
  return mergeRecords(recordSets);
}

/** Active runs from the merged registry view. */
export function mergedActiveRuns(
  stateDir: string,
  stateDirRel: string = DEFAULT_STATE_DIR,
): RunRecord[] {
  return readMergedRegistry(stateDir, stateDirRel).filter(
    (r) => r.status === "running",
  );
}

/** Recent runs from the merged registry view, sorted by updated_at desc. */
export function mergedRecentRuns(
  stateDir: string,
  limit: number,
  stateDirRel: string = DEFAULT_STATE_DIR,
): RunRecord[] {
  const all = readMergedRegistry(stateDir, stateDirRel);
  all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all.slice(0, limit);
}

/**
 * Find a run by exact or prefix match across the merged registry.
 */
export function mergedFindRunByPrefix(
  stateDir: string,
  partial: string,
  stateDirRel: string = DEFAULT_STATE_DIR,
): RunRecord | RunRecord[] | undefined {
  const all = readMergedRegistry(stateDir, stateDirRel);
  const exact = all.find((r) => r.run_id === partial);
  if (exact) return exact;
  const matches = all.filter((r) => r.run_id.startsWith(partial));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches;
  return undefined;
}
