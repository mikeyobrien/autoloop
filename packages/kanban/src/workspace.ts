// Resolve a stable "scope" string for persistent tasks. Prefers the git root,
// falls back to the literal cwd. The returned path is absolute and suitable
// for use as a filter key across the kanban task store.

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasGitRoot(dir: string): boolean {
  return isDir(`${dir}/.git`) || existsSync(`${dir}/.git`);
}

function walkUp(start: string, match: (dir: string) => boolean): string | null {
  let dir = resolve(start);
  while (true) {
    if (match(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function detectGitRoot(cwd = process.cwd()): string | null {
  return walkUp(cwd, hasGitRoot);
}

/**
 * Resolve the task-scope key for a directory. Git root → cwd. Always returns
 * an absolute path.
 */
export function detectScope(cwd = process.cwd()): string {
  return detectGitRoot(cwd) ?? resolve(cwd);
}
