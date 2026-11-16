import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";

/** Untracked files above this size are skipped (the old `cat` maxBuffer). */
const UNTRACKED_READ_LIMIT_BYTES = 20 * 1024 * 1024;

export interface AddedLine {
  file: string;
  text: string;
}

function git(workDir: string, args: string[]): { ok: boolean; stdout: string } {
  const res = spawnSync("git", args, {
    cwd: workDir,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return { ok: res.status === 0, stdout: res.stdout ?? "" };
}

export function isGitRepo(workDir: string): boolean {
  return git(workDir, ["rev-parse", "--is-inside-work-tree"]).ok;
}

/**
 * Lines introduced this run: added (`+`) lines from `git diff HEAD` plus the
 * full contents of untracked, non-ignored files (which a diff against HEAD does
 * not include). This is the surface a reward-hack would land on.
 */
export function collectAddedLines(workDir: string): AddedLine[] {
  const lines: AddedLine[] = [];
  const diff = git(workDir, ["diff", "--unified=0", "--no-color", "HEAD"]);
  if (diff.ok) {
    let file = "";
    for (const raw of diff.stdout.split("\n")) {
      if (raw.startsWith("+++ b/")) {
        file = raw.slice(6);
      } else if (raw.startsWith("+++ ")) {
        file = raw.slice(4);
      } else if (raw.startsWith("+") && !raw.startsWith("+++")) {
        lines.push({ file, text: raw.slice(1) });
      }
    }
  }
  for (const file of untrackedFiles(workDir)) {
    // Read in-process: `cat` is not on PATH in a default Git for Windows
    // install, which would silently skip untracked content.
    let content: string;
    try {
      const path = join(workDir, file);
      // Regular files only: a device or FIFO (also through a symlink) can
      // report size 0 and never reach EOF.
      const st = statSync(path);
      if (!st.isFile() || st.size > UNTRACKED_READ_LIMIT_BYTES) continue;
      content = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    for (const text of content.split("\n")) {
      lines.push({ file, text });
    }
  }
  return lines;
}

function untrackedFiles(workDir: string): string[] {
  const res = git(workDir, ["ls-files", "--others", "--exclude-standard"]);
  return res.ok ? res.stdout.split("\n").filter(Boolean) : [];
}

/**
 * Files changed this run: tracked files differing from HEAD plus untracked,
 * non-ignored files. Used to detect whether a given class of file (e.g. tests)
 * was touched during the run that claims completion.
 */
export function changedFiles(workDir: string): string[] {
  const tracked = git(workDir, ["diff", "--name-only", "--no-color", "HEAD"]);
  const files = new Set<string>();
  if (tracked.ok) {
    for (const f of tracked.stdout.split("\n").filter(Boolean)) files.add(f);
  }
  for (const f of untrackedFiles(workDir)) files.add(f);
  return [...files];
}

/** Dirty working tree entries from `git status --porcelain`. */
export function porcelainStatus(workDir: string): string[] {
  const res = git(workDir, ["status", "--porcelain"]);
  return res.ok ? res.stdout.split("\n").filter(Boolean) : [];
}

const WALK_SKIP = new Set([".git", "node_modules"]);

/** Bounded recursive file listing used when git is unavailable (non-repo). */
function walkFiles(workDir: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 20) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const absolute = join(dir, name);
      let stat: Stats | undefined;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!WALK_SKIP.has(name)) visit(absolute, depth + 1);
      } else if (stat.isFile()) {
        out.push(absolute.slice(workDir.length + 1));
      }
    }
  };
  visit(workDir, 0);
  return out;
}

/**
 * Every file currently in the work tree (tracked + untracked, non-ignored),
 * as workdir-relative paths with forward slashes. Falls back to a bounded
 * recursive walk outside a git repo so the frozen-paths snapshot stays
 * functional without git.
 */
export function listWorkTreeFiles(workDir: string): string[] {
  const res = git(workDir, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".",
  ]);
  if (res.ok) {
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replaceAll("\\", "/"));
  }
  return walkFiles(workDir);
}
