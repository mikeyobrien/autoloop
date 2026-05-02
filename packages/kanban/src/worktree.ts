// Git-worktree helpers for per-task workspaces. Each kanban task that needs
// an isolated tree gets its own `git worktree` under a caller-chosen path
// (typically ~/.autoloop/worktrees/<taskId>), on a dedicated branch
// (default: autoloop/task-<taskId>). Keeps the user's main checkout untouched
// while the agent hacks in parallel, and makes diffs per-task trivially
// reviewable via standard git tooling.
//
// All functions here are pure-ish: they shell out to `git` via
// execFileSync (no shell interpolation → no quoting bugs / injection) and
// perform local filesystem work. No PTY, no config, no logging. The
// kanban_server owns when to call these; this module owns how.
//
// Safety invariants:
//   1. Never pass user strings into a shell — always execFileSync("git", [args]).
//   2. `removeTaskWorktree` refuses to delete a worktree with uncommitted
//      changes or unpushed commits unless `force: true` is explicitly set.
//      This is the "don't lose the agent's work" backstop — hidden-sweep
//      and auto-reclaim paths must not bypass it.
//   3. `copyWorktreeIncludes` rejects any `.autoloop-worktreeinclude` entry
//      that resolves outside the source repo root (absolute paths, `..`
//      segments, symlink escapes). The include file is user-controlled
//      config; treat it as untrusted.

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Resolve the git binary. On macOS force /usr/bin/git because some
 *  environments ship Linux-built git binaries that can't exec on Darwin and
 *  may appear first on PATH. */
function gitBinary(): string {
  return platform() === "darwin" ? "/usr/bin/git" : "git";
}

/** execFileSync("git", ...) wrapper. Captures stdout as utf-8, discards
 *  stderr by default (callers that want it can pass stdio). Returns the
 *  trimmed stdout, or throws the raw child_process error on non-zero exit. */
function git(
  cwd: string,
  args: string[],
  opts: ExecFileSyncOptions = {},
): string {
  const out = execFileSync(gitBinary(), args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
  return typeof out === "string" ? out.trim() : String(out).trim();
}

/** Same as git() but returns undefined instead of throwing. Used for
 *  queries where "not a git repo" / "no upstream" is a legitimate answer. */
function gitSoft(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Repo-root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the MAIN working tree's root starting from `cwd`. Handles the
 * nested-worktree case: when called from inside a linked worktree, returns
 * the top-level checkout (not the linked worktree's own root). This is
 * what `git worktree add` expects as its invocation cwd and is the right
 * anchor for sibling-worktree placement.
 *
 * Strategy:
 *   1. `git rev-parse --path-format=absolute --git-common-dir` always
 *      points at the main `.git` directory (never a linked worktree's
 *      `.git/worktrees/<name>` gitdir).
 *   2. The main worktree is the parent of that .git dir. We verify with
 *      a second `rev-parse --show-toplevel` run from that parent — if the
 *      main repo is bare, parent(common-dir) is NOT a worktree; we fall
 *      back to the current worktree's toplevel so the caller still gets
 *      a usable root.
 *
 * Returns undefined if `cwd` is not inside a git repository.
 */
export function resolveRepoRoot(cwd: string): string | undefined {
  if (!existsSync(cwd)) return undefined;
  const commonDir = gitSoft(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!commonDir) return undefined;
  // common-dir is typically "<main>/.git". Parent of that is the main
  // worktree's root. Validate by checking that dir resolves as a worktree
  // toplevel from its own perspective.
  const candidate = dirname(commonDir);
  const mainTop = gitSoft(candidate, ["rev-parse", "--show-toplevel"]);
  if (mainTop && existsSync(mainTop)) return resolve(mainTop);
  // Bare or unusable main — fall back to current worktree's toplevel.
  const fallback = gitSoft(cwd, ["rev-parse", "--show-toplevel"]);
  return fallback ? resolve(fallback) : undefined;
}

// ---------------------------------------------------------------------------
// Create / remove
// ---------------------------------------------------------------------------

export interface CreateWorktreeOptions {
  /** Absolute path to the main repo root (output of resolveRepoRoot). */
  repoRoot: string;
  /** Absolute path where the new worktree should be created. Must NOT
   *  already exist — `git worktree add` fails on pre-existing dirs. */
  worktreeDir: string;
  /** Branch to create for this worktree. Defaults to `autoloop/task-<taskId>`. */
  branch?: string;
  /** Task id; used to derive the default branch name. */
  taskId?: string;
  /** Base ref the new branch starts from. Default: current HEAD of repoRoot. */
  baseRef?: string;
}

export interface CreateWorktreeResult {
  worktreeDir: string;
  branch: string;
}

/** Create a new git worktree at `worktreeDir` on a dedicated branch. The
 *  branch is created fresh from `baseRef` (or HEAD if unspecified). Throws
 *  if the worktree path already exists or the branch already exists. */
export function createTaskWorktree(
  opts: CreateWorktreeOptions,
): CreateWorktreeResult {
  const { repoRoot, worktreeDir } = opts;
  if (!existsSync(repoRoot))
    throw new Error(`repoRoot does not exist: ${repoRoot}`);
  if (existsSync(worktreeDir))
    throw new Error(`worktreeDir already exists: ${worktreeDir}`);
  const branch =
    opts.branch ?? (opts.taskId ? `autoloop/task-${opts.taskId}` : undefined);
  if (!branch) throw new Error("createTaskWorktree: branch or taskId required");
  const args = ["worktree", "add", "-b", branch, worktreeDir];
  if (opts.baseRef) args.push(opts.baseRef);
  git(repoRoot, args);
  return { worktreeDir: resolve(worktreeDir), branch };
}

export interface RemoveWorktreeOptions {
  repoRoot: string;
  worktreeDir: string;
  /** When true, bypass dirty/unpushed safety checks AND pass --force to
   *  `git worktree remove`. Only set from explicit user actions (e.g. a
   *  "force-discard" button); auto-reclaim paths must leave this false. */
  force?: boolean;
}

/** Remove a worktree. Refuses to proceed when the worktree has uncommitted
 *  changes or unpushed commits unless `force: true`. On success the worktree
 *  dir + git metadata entry are both gone; the branch is preserved so the
 *  user can recover the work via `git checkout <branch>`. */
export function removeTaskWorktree(opts: RemoveWorktreeOptions): void {
  const { repoRoot, worktreeDir, force } = opts;
  if (!existsSync(worktreeDir)) {
    // Already gone — prune the registry and return.
    gitSoft(repoRoot, ["worktree", "prune"]);
    return;
  }
  if (!force) {
    if (isWorktreeDirty(worktreeDir)) {
      throw new Error(
        `worktree has uncommitted changes: ${worktreeDir} (pass force:true to discard)`,
      );
    }
    if (hasUnpushedCommits(worktreeDir)) {
      throw new Error(
        `worktree has unpushed commits: ${worktreeDir} (pass force:true to discard)`,
      );
    }
  }
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreeDir);
  git(repoRoot, args);
}

// ---------------------------------------------------------------------------
// State queries
// ---------------------------------------------------------------------------

/** True iff `git status --porcelain` in the worktree reports any entry
 *  (modified, untracked, staged, or conflicted). Returns true on any git
 *  failure so callers fail-safe toward preserving work. */
export function isWorktreeDirty(worktreeDir: string): boolean {
  try {
    const out = git(worktreeDir, ["status", "--porcelain"]);
    return out.length > 0;
  } catch {
    return true;
  }
}

/** True iff the worktree's HEAD has commits not yet reachable from any
 *  remote-tracking ref. Handles three cases:
 *    - branch has an upstream: count @{u}..HEAD
 *    - no upstream but remotes exist: count HEAD --not --remotes
 *    - no remotes at all: any commit on the branch is "unpushed"
 *  Fail-safe to `true` on any git error — same rationale as isWorktreeDirty. */
export function hasUnpushedCommits(worktreeDir: string): boolean {
  try {
    const upstream = gitSoft(worktreeDir, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (upstream) {
      const n = git(worktreeDir, ["rev-list", "--count", "@{u}..HEAD"]);
      return Number.parseInt(n, 10) > 0;
    }
    // No upstream. If the repo has any remote-tracking refs, diff HEAD
    // against all of them. If not, the branch is entirely local → unpushed.
    const remotes = gitSoft(worktreeDir, [
      "for-each-ref",
      "--count=1",
      "refs/remotes/",
    ]);
    if (remotes && remotes.length > 0) {
      const n = git(worktreeDir, [
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        "--remotes",
      ]);
      return Number.parseInt(n, 10) > 0;
    }
    // No remotes. If HEAD points at a valid commit, treat as unpushed.
    const head = gitSoft(worktreeDir, ["rev-parse", "--verify", "HEAD"]);
    return Boolean(head);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// .autoloop-worktreeinclude — copy user-nominated files into a fresh worktree
// ---------------------------------------------------------------------------

/** Name of the opt-in manifest file at the repo root. One path per line;
 *  blank lines and `#`-prefixed comments are ignored. Paths must be
 *  relative to the source repo root and must not escape it. */
export const WORKTREE_INCLUDE_FILE = ".autoloop-worktreeinclude";

export interface CopyIncludesResult {
  copied: string[];
  skipped: { path: string; reason: string }[];
}

/**
 * Copy each path listed in `<srcRepoRoot>/.autoloop-worktreeinclude` from
 * srcRepoRoot into destWorktree, preserving the relative layout. Intended
 * for bootstrap files that are gitignored but needed for the agent to
 * actually build (node_modules, .env files, local keys, generated assets).
 *
 * Rejects with a thrown Error — NOT a silent skip — when any listed path:
 *   - is absolute
 *   - contains `..` segments
 *   - resolves (after symlink expansion) outside srcRepoRoot
 *
 * This is defensive: the include file is config, config is untrusted, and
 * a malicious/typo'd `../../.ssh/id_rsa` entry would otherwise copy host
 * secrets into the agent's sandbox.
 *
 * Missing paths (not present in srcRepoRoot) are recorded in `skipped`, not
 * thrown — makes the file forgiving to cross-repo reuse.
 */
export function copyWorktreeIncludes(
  srcRepoRoot: string,
  destWorktree: string,
): CopyIncludesResult {
  const result: CopyIncludesResult = { copied: [], skipped: [] };
  const manifestPath = join(srcRepoRoot, WORKTREE_INCLUDE_FILE);
  if (!existsSync(manifestPath)) return result;
  const srcAbs = resolve(srcRepoRoot);
  const lines = readFileSync(manifestPath, "utf-8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (isAbsolute(line)) {
      throw new Error(
        `${WORKTREE_INCLUDE_FILE}: absolute path not allowed: ${line}`,
      );
    }
    // Normalize. `resolve` collapses `..` for us; compare against srcAbs
    // to catch any escape. Also reject if the normalized relative path
    // starts with `..` (belt-and-suspenders; resolve() already handles it).
    const target = resolve(srcAbs, line);
    const rel = relative(srcAbs, target);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `${WORKTREE_INCLUDE_FILE}: path escapes repo root: ${line}`,
      );
    }
    if (!existsSync(target)) {
      result.skipped.push({ path: line, reason: "not found" });
      continue;
    }
    // Symlink escape check: realpath the target and verify it's still
    // under srcAbs. A symlink inside the repo pointing at /etc/passwd
    // would otherwise let us copy host content in. Use realpathSync on
    // the src repo too — on macOS /tmp → /private/tmp resolution would
    // otherwise make every path look "escaping".
    try {
      const realTarget = realpathSync(target);
      const realSrc = realpathSync(srcAbs);
      if (realTarget !== realSrc && !realTarget.startsWith(realSrc + sep)) {
        throw new Error(
          `${WORKTREE_INCLUDE_FILE}: symlink escapes repo root: ${line}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("symlink escapes"))
        throw err;
      // realpath may fail on dangling symlinks — treat as skip.
      result.skipped.push({ path: line, reason: "realpath failed" });
      continue;
    }
    const destPath = join(destWorktree, rel);
    const isDir = statSync(target).isDirectory();
    cpSync(target, destPath, {
      recursive: isDir,
      force: true,
      dereference: false,
    });
    result.copied.push(rel);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Orphan listing
// ---------------------------------------------------------------------------

export interface OrphanWorktree {
  /** Registered path. May no longer exist on disk. */
  worktreeDir: string;
  /** Short branch name if known. */
  branch?: string;
  /** Reason `git` considers this worktree prunable (e.g. "gitdir file
   *  points to non-existent location"). */
  reason: string;
}

/**
 * List worktrees that git considers prunable — typically because the user
 * deleted the worktree directory manually and the gitdir registry entry
 * is now dangling. The kanban hidden-sweep uses this to reclaim stale
 * registry entries without running `git worktree prune` unconditionally
 * (which would also drop locked worktrees).
 *
 * Returns [] if `repoRoot` isn't a git repo.
 */
export function listOrphanWorktrees(repoRoot: string): OrphanWorktree[] {
  const raw = gitSoft(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!raw) return [];
  const orphans: OrphanWorktree[] = [];
  // Porcelain format: records separated by blank lines. Each record starts
  // with `worktree <path>`, then optional `HEAD <sha>`, `branch <ref>`,
  // `bare`, `detached`, `locked [reason]`, `prunable [reason]`.
  const records = raw.split(/\n\s*\n/);
  for (const rec of records) {
    const lines = rec.split("\n");
    let wt = "";
    let branch: string | undefined;
    let prunable: string | undefined;
    for (const line of lines) {
      if (line.startsWith("worktree ")) wt = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        prunable =
          line === "prunable" ? "prunable" : line.slice("prunable ".length);
      }
    }
    if (wt && prunable)
      orphans.push({ worktreeDir: wt, branch, reason: prunable });
  }
  return orphans;
}
