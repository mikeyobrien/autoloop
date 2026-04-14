import { execSync } from "node:child_process";
import { shellQuote } from "../utils.js";
import { resolveGitRoot } from "./create.js";
import type { WorktreeMeta } from "./meta.js";
import { readMeta, updateStatus } from "./meta.js";

const DEFAULT_GIT_NAME = "autoloop";
const DEFAULT_GIT_EMAIL = "autoloop@local";

export interface MergeOpts {
  metaDir: string;
  strategy?: "squash" | "merge" | "rebase";
  workDir: string;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  recoveryHint?: string;
}

export function mergeWorktree(opts: MergeOpts): MergeResult {
  const { metaDir, strategy = "squash", workDir } = opts;
  const gitRoot = resolveGitRoot(workDir);

  const meta = readMeta(metaDir);
  if (!meta) throw new Error(`no worktree meta found in ${metaDir}`);

  validateMergeStatus(meta);

  const baseBranch = meta.base_branch;
  const branch = meta.branch;
  const gitEnv = resolveGitEnv(gitRoot);

  // Checkout base branch
  exec(gitRoot, `git checkout ${shellQuote(baseBranch)}`, gitEnv);

  try {
    if (strategy === "squash") {
      exec(gitRoot, `git merge --squash ${shellQuote(branch)}`, gitEnv);
      exec(
        gitRoot,
        `git commit --no-edit -m ${shellQuote(`merge worktree ${meta.run_id} (squash)`)}`,
        gitEnv,
      );
    } else if (strategy === "rebase") {
      exec(gitRoot, `git rebase ${shellQuote(branch)}`, gitEnv);
    } else {
      exec(
        gitRoot,
        `git merge --no-ff ${shellQuote(branch)} -m ${shellQuote(`merge worktree ${meta.run_id}`)}`,
        gitEnv,
      );
    }
  } catch (err: unknown) {
    // Attempt to detect conflicts and abort
    const msg = err instanceof Error ? err.message : String(err);
    const conflicts = detectConflicts(gitRoot);
    try {
      if (strategy === "rebase") {
        exec(gitRoot, "git rebase --abort", gitEnv);
      } else {
        exec(gitRoot, "git merge --abort", gitEnv);
      }
    } catch {
      /* abort best-effort */
    }

    if (conflicts.length > 0) {
      return {
        success: false,
        conflicts,
        recoveryHint: `Resolve conflicts manually, then run: git merge ${branch}`,
      };
    }
    throw new Error(`merge failed: ${msg}`);
  }

  updateStatus(metaDir, "merged");
  return { success: true };
}

function validateMergeStatus(meta: WorktreeMeta): void {
  if (meta.status === "running") {
    throw new Error(`cannot merge worktree ${meta.run_id}: still running`);
  }
  if (meta.status === "merged") {
    throw new Error(`worktree ${meta.run_id} is already merged`);
  }
  if (meta.status === "removed") {
    throw new Error(`worktree ${meta.run_id} has been removed`);
  }
}

function detectConflicts(cwd: string): string[] {
  try {
    const out = execSync("git diff --name-only --diff-filter=U", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

function resolveGitEnv(cwd: string): NodeJS.ProcessEnv | undefined {
  const configuredName = readGitConfig(cwd, "user.name");
  const configuredEmail = readGitConfig(cwd, "user.email");
  const hasIdentityEnv =
    hasText(process.env.GIT_AUTHOR_NAME) ||
    hasText(process.env.GIT_AUTHOR_EMAIL) ||
    hasText(process.env.GIT_COMMITTER_NAME) ||
    hasText(process.env.GIT_COMMITTER_EMAIL);

  if (!hasIdentityEnv && configuredName && configuredEmail) {
    return undefined;
  }

  const fallbackName = textOr(process.env.AUTOLOOP_GIT_NAME, DEFAULT_GIT_NAME);
  const fallbackEmail = textOr(
    process.env.AUTOLOOP_GIT_EMAIL,
    DEFAULT_GIT_EMAIL,
  );
  const authorName =
    textOr(process.env.GIT_AUTHOR_NAME) ?? configuredName ?? fallbackName;
  const authorEmail =
    textOr(process.env.GIT_AUTHOR_EMAIL) ?? configuredEmail ?? fallbackEmail;
  const committerName =
    textOr(process.env.GIT_COMMITTER_NAME) ?? configuredName ?? authorName;
  const committerEmail =
    textOr(process.env.GIT_COMMITTER_EMAIL) ?? configuredEmail ?? authorEmail;

  return {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: committerName,
    GIT_COMMITTER_EMAIL: committerEmail,
  };
}

function readGitConfig(cwd: string, key: string): string | undefined {
  try {
    const value = execSync(`git config --get ${shellQuote(key)}`, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function textOr(
  value: string | undefined,
  fallback?: string,
): string | undefined {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function exec(cwd: string, cmd: string, env?: NodeJS.ProcessEnv): string {
  return execSync(cmd, { cwd, encoding: "utf-8", env, stdio: "pipe" });
}
