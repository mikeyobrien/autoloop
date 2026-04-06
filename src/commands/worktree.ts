import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readMeta } from "../worktree/meta.js";
import { mergeWorktree } from "../worktree/merge.js";
import { cleanWorktrees } from "../worktree/clean.js";
import type { WorktreeMeta } from "../worktree/meta.js";
import type { MergeOpts } from "../worktree/merge.js";

export function dispatchWorktree(args: string[]): void {
  const projectDir = resolveProjectDir();
  const stateDir = join(projectDir, ".autoloop");

  if (args.length === 0 || args[0] === "list") {
    listWorktrees(stateDir);
    return;
  }

  const sub = args[0];

  if (sub === "--help" || sub === "-h") {
    printWorktreeUsage();
    return;
  }

  if (sub === "show") {
    const runId = args[1];
    if (!runId) { console.log("Usage: autoloop worktree show <run-id>"); return; }
    showWorktree(stateDir, runId);
    return;
  }

  if (sub === "merge") {
    const runId = args[1];
    if (!runId) { console.log("Usage: autoloop worktree merge <run-id> [--strategy <s>]"); return; }
    const strategy = parseFlag(args, "--strategy") as MergeOpts["strategy"] | undefined;
    doMerge(projectDir, stateDir, runId, strategy);
    return;
  }

  if (sub === "clean") {
    const all = args.includes("--all");
    const force = args.includes("--force");
    const runId = args.find(a => !a.startsWith("--") && a !== "clean");
    doClean(projectDir, stateDir, { runId, all, force });
    return;
  }

  console.log("Unknown worktree subcommand: " + sub);
  printWorktreeUsage();
}

function listWorktrees(stateDir: string): void {
  const worktreesDir = join(stateDir, "worktrees");
  if (!existsSync(worktreesDir)) { console.log("No worktrees found."); return; }

  const entries = readdirSync(worktreesDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  if (entries.length === 0) { console.log("No worktrees found."); return; }

  const header = [
    "RUN ID".padEnd(24),
    "STATUS".padEnd(12),
    "BRANCH".padEnd(30),
    "STRATEGY".padEnd(10),
    "CREATED",
  ].join("  ");
  console.log(header);

  for (const entry of entries) {
    const meta = readMeta(join(worktreesDir, entry.name));
    if (!meta) continue;
    const line = [
      truncate(meta.run_id, 24).padEnd(24),
      meta.status.padEnd(12),
      truncate(meta.branch, 30).padEnd(30),
      meta.merge_strategy.padEnd(10),
      formatTime(meta.created_at),
    ].join("  ");
    console.log(line);
  }
}

function showWorktree(stateDir: string, runId: string): void {
  const metaDir = join(stateDir, "worktrees", runId);
  const meta = readMeta(metaDir);
  if (!meta) { console.log(`No worktree found for run ${runId}`); return; }

  const lines = [
    field("Run ID", meta.run_id),
    field("Status", meta.status),
    field("Branch", meta.branch),
    field("Base", meta.base_branch),
    field("Strategy", meta.merge_strategy),
    field("Path", meta.worktree_path),
    field("Created", meta.created_at),
  ];
  if (meta.merged_at) lines.push(field("Merged", meta.merged_at));
  if (meta.removed_at) lines.push(field("Removed", meta.removed_at));
  console.log(lines.join("\n"));
}

function doMerge(
  projectDir: string,
  stateDir: string,
  runId: string,
  strategy?: MergeOpts["strategy"],
): void {
  const metaDir = join(stateDir, "worktrees", runId);
  const result = mergeWorktree({ mainProjectDir: projectDir, metaDir, strategy });

  if (result.success) {
    console.log(`Merged worktree ${runId} successfully.`);
  } else {
    console.log(`Merge failed for ${runId}.`);
    if (result.conflicts?.length) {
      console.log("Conflicting files:");
      for (const f of result.conflicts) console.log("  " + f);
    }
    if (result.recoveryHint) console.log(result.recoveryHint);
    process.exitCode = 1;
  }
}

function doClean(
  projectDir: string,
  stateDir: string,
  opts: { runId?: string; all?: boolean; force?: boolean },
): void {
  const result = cleanWorktrees({
    mainProjectDir: projectDir,
    mainStateDir: stateDir,
    runId: opts.runId,
    all: opts.all,
    force: opts.force,
  });

  if (result.removed.length === 0) {
    console.log("No worktrees to clean.");
  } else {
    console.log(`Cleaned ${result.removed.length} worktree(s): ${result.removed.join(", ")}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length}: ${result.skipped.join(", ")}`);
  }
}

function printWorktreeUsage(): void {
  console.log("Usage:");
  console.log("  autoloop worktree                         List worktrees");
  console.log("  autoloop worktree list                    List worktrees");
  console.log("  autoloop worktree show <run-id>           Show worktree details");
  console.log("  autoloop worktree merge <run-id> [--strategy <squash|merge|rebase>]");
  console.log("  autoloop worktree clean [--all] [--force] [<run-id>]");
}

function resolveProjectDir(): string {
  return process.env["MINILOOPS_PROJECT_DIR"] || ".";
}

function field(label: string, value: string): string {
  return (label + ":").padEnd(12) + value;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 2) + "..";
}

function formatTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
