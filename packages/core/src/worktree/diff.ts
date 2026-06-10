import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { shellQuote } from "@mobrienv/autoloop-core";
import { readMeta } from "./meta.js";

export interface DiffWorktreeOpts {
  metaDir: string;
  workDir: string;
  /** Include the full unified patch in the result. */
  patch?: boolean;
}

export type DiffFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export interface DiffFileEntry {
  path: string;
  status: DiffFileStatus;
}

export interface DiffWorktreeResult {
  branch: string;
  base: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFileEntry[];
  patch?: string;
}

export function diffWorktree(opts: DiffWorktreeOpts): DiffWorktreeResult {
  const { metaDir, workDir, patch = false } = opts;

  const meta = readMeta(metaDir);
  if (!meta) throw new Error(`no worktree meta found in ${metaDir}`);

  // Prefer running git inside the worktree itself; fall back to the project
  // dir if the worktree directory is gone but the branch may still exist
  // (refs are shared with the main repository).
  const cwd = existsSync(meta.worktree_path) ? meta.worktree_path : workDir;
  if (!existsSync(cwd)) {
    throw new Error(
      `worktree path ${meta.worktree_path} no longer exists for run ${meta.run_id}`,
    );
  }

  const base = meta.base_branch;
  const branch = meta.branch;
  const range = shellQuote(`${base}...${branch}`);

  const numstatOut = gitDiff(cwd, `git diff --numstat ${range}`, meta.run_id);
  const nameStatusOut = gitDiff(
    cwd,
    `git diff --name-status ${range}`,
    meta.run_id,
  );

  let insertions = 0;
  let deletions = 0;
  for (const line of splitLines(numstatOut)) {
    const [ins, del] = line.split("\t");
    if (ins !== "-") insertions += Number.parseInt(ins, 10) || 0;
    if (del !== "-") deletions += Number.parseInt(del, 10) || 0;
  }

  const files: DiffFileEntry[] = splitLines(nameStatusOut).map((line) => {
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    // Renames/copies are "R100\told\tnew"; report the new path.
    const path = parts[parts.length - 1] ?? "";
    return { path, status: statusFromCode(code) };
  });

  const result: DiffWorktreeResult = {
    branch,
    base,
    filesChanged: files.length,
    insertions,
    deletions,
    files,
  };

  if (patch) {
    result.patch = gitDiff(cwd, `git diff ${range}`, meta.run_id);
  }

  return result;
}

function gitDiff(cwd: string, cmd: string, runId: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to diff worktree for run ${runId}: ${msg}`);
  }
}

function splitLines(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function statusFromCode(code: string): DiffFileStatus {
  switch (code.charAt(0)) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}
