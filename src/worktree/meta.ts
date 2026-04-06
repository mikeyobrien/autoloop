import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type WorktreeStatus = "running" | "completed" | "failed" | "merged" | "removed";

export interface WorktreeMeta {
  run_id: string;
  branch: string;
  worktree_path: string;
  base_branch: string;
  status: WorktreeStatus;
  merge_strategy: string;
  created_at: string;
  merged_at: string | null;
  removed_at: string | null;
}

const META_FILE = "meta.json";

export function metaDirForRun(mainStateDir: string, runId: string): string {
  return join(mainStateDir, "worktrees", runId);
}

export function writeMeta(metaDir: string, meta: WorktreeMeta): void {
  mkdirSync(metaDir, { recursive: true });
  const target = join(metaDir, META_FILE);
  const tmp = target + ".tmp";
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + "\n");
  renameSync(tmp, target);
}

export function readMeta(metaDir: string): WorktreeMeta | null {
  const target = join(metaDir, META_FILE);
  if (!existsSync(target)) return null;
  return JSON.parse(readFileSync(target, "utf-8")) as WorktreeMeta;
}

export function isOrphanWorktree(meta: WorktreeMeta): boolean {
  return meta.status !== "removed" && !existsSync(meta.worktree_path);
}

export function updateStatus(metaDir: string, status: WorktreeStatus): void {
  const meta = readMeta(metaDir);
  if (!meta) throw new Error(`no worktree meta found in ${metaDir}`);
  meta.status = status;
  if (status === "merged") meta.merged_at = new Date().toISOString();
  if (status === "removed") meta.removed_at = new Date().toISOString();
  writeMeta(metaDir, meta);
}
