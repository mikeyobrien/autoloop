import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readMeta } from "./meta.js";
import type { WorktreeMeta } from "./meta.js";

export interface WorktreeListEntry extends WorktreeMeta {
  orphan: boolean;
}

/**
 * List all worktree metadata entries, flagging orphans where the
 * worktree path no longer exists on disk but meta.json is still present.
 */
export function listWorktreeMetas(mainStateDir: string): WorktreeListEntry[] {
  const worktreesDir = join(mainStateDir, "worktrees");
  if (!existsSync(worktreesDir)) return [];

  const entries: WorktreeListEntry[] = [];

  for (const dirent of readdirSync(worktreesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const meta = readMeta(join(worktreesDir, dirent.name));
    if (!meta) continue;

    const orphan =
      meta.status !== "removed" && !existsSync(meta.worktree_path);

    entries.push({ ...meta, orphan });
  }

  return entries;
}
