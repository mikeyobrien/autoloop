import { spawnSync } from "node:child_process";

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
    const content = spawnSync("cat", [file], {
      cwd: workDir,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (content.status === 0) {
      for (const text of (content.stdout ?? "").split("\n")) {
        lines.push({ file, text });
      }
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
