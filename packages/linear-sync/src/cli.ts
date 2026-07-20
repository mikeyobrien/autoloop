#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IssueSyncConfig } from "@mobrienv/autoloop-issue-sync-core";
import {
  createJsonlTasksApi,
  pull,
  push,
  release,
} from "@mobrienv/autoloop-issue-sync-core";
import type { LinearSyncConfig } from "./adapter.js";
import { LinearAdapter } from "./adapter.js";

/**
 * Resolve the state-root directory for issue-sync files.
 *
 * linear-sync runs as a standalone hook binary and cannot load the full autoloop
 * preset, so it honors this runtime contract instead:
 *  1. `AUTOLOOP_STATE_DIR` env var (set by the harness) — highest priority.
 *  2. `core.state_dir` read directly from `<projectDir>/autoloops.toml`.
 *  3. The `.autoloop` default.
 * (The task store additionally honors `AUTOLOOP_TASKS_FILE`; see `tasksFileFor`.)
 */
function stateDirFor(projectDir: string): string {
  const envDir = process.env.AUTOLOOP_STATE_DIR;
  if (envDir) return envDir;
  let stateName = ".autoloop";
  try {
    const raw = readFileSync(join(projectDir, "autoloops.toml"), "utf-8");
    const m = raw.match(/^\s*state_dir\s*=\s*"([^"]+)"/m);
    if (m) stateName = m[1];
  } catch {
    // No project config: fall back to the default state root.
  }
  return join(projectDir, stateName);
}

function loadIssueSyncConfig(projectDir: string): {
  syncConfig: IssueSyncConfig;
  linearConfig: LinearSyncConfig;
} {
  const tomlPath = join(stateDirFor(projectDir), "issue-sync.toml");
  if (!existsSync(tomlPath)) {
    throw new Error(
      `No issue-sync.toml found under ${stateDirFor(projectDir)}`,
    );
  }
  return parseIssueSyncToml(readFileSync(tomlPath, "utf-8"));
}

function parseIssueSyncToml(raw: string): {
  syncConfig: IssueSyncConfig;
  linearConfig: LinearSyncConfig;
} {
  const projectMatch = raw.match(/^\s*project\s*=\s*"([^"]+)"/m);
  const teamMatch = raw.match(/^\s*team\s*=\s*"([^"]+)"/m);
  const repoLabelMatch = raw.match(/^\s*repo_label\s*=\s*"([^"]+)"/m);
  const pullStatesMatch = raw.match(/^\s*pull_states\s*=\s*\[([^\]]+)\]/m);
  const reviewStateMatch = raw.match(/^\s*review_state\s*=\s*"([^"]+)"/m);
  const doneStateMatch = raw.match(/^\s*done_state\s*=\s*"([^"]+)"/m);

  const pullStates = pullStatesMatch
    ? pullStatesMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
    : ["Todo"];

  return {
    syncConfig: {
      tracker: "linear",
      linear: {
        project: projectMatch?.[1],
        team: teamMatch?.[1],
        repoLabel: repoLabelMatch?.[1],
        pullStates,
        reviewState: reviewStateMatch?.[1] ?? "In Review",
        doneState: doneStateMatch?.[1] ?? "Done",
      },
    },
    linearConfig: {
      apiKey: process.env.LINEAR_API_KEY ?? "",
      teamKey: teamMatch?.[1],
      projectName: projectMatch?.[1],
      repoLabel: repoLabelMatch?.[1],
    },
  };
}

function git(args: string[]): string | undefined {
  const r = spawnSync("git", args, { encoding: "utf-8" });
  return r.status === 0 && r.stdout ? r.stdout.trim() : undefined;
}

function tasksFileFor(projectDir: string): string {
  return (
    process.env.AUTOLOOP_TASKS_FILE ??
    join(stateDirFor(projectDir), "tasks.jsonl")
  );
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const subcommand = cliArgs[0];
  const projectDir = process.env.AUTOLOOP_PROJECT_DIR ?? process.cwd();
  const runId = process.env.AUTOLOOP_RUN_ID ?? "";
  const stateFile = join(stateDirFor(projectDir), "issue-sync-state.json");

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    console.log(
      "Usage: autoloop-linear-sync <pull|push|release> [options]\n" +
        "  pull                       Pull Linear issues into the task queue\n" +
        "  push [--release] [--no-archive]    Move completed tasks' issues to In Review;\n" +
        "                                     --release also promotes In Review → Done\n" +
        "  release <version> [--no-archive]   Promote In-Review issues to Done\n" +
        "\nRequires: LINEAR_API_KEY env var",
    );
    process.exit(0);
  }

  const { syncConfig, linearConfig } = loadIssueSyncConfig(projectDir);
  const adapter = new LinearAdapter(linearConfig);
  const tasksApi = createJsonlTasksApi(tasksFileFor(projectDir));
  const noteCtx = {
    runId: runId || undefined,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  };

  if (subcommand === "pull") {
    const result = await pull(adapter, syncConfig, tasksApi, stateFile);
    console.log(`autoloop-linear-sync pull: added ${result.added} issue(s)`);
    for (const it of result.addedIssues) {
      console.log(`  + ${it.identifier ?? it.externalId}  ${it.title}`);
    }
  } else if (subcommand === "push") {
    const result = await push(
      adapter,
      syncConfig,
      tasksApi,
      stateFile,
      noteCtx,
      {
        release: cliArgs.includes("--release"),
        archive: !cliArgs.includes("--no-archive"),
      },
    );
    console.log(
      `autoloop-linear-sync push: transitioned ${result.transitioned}, created ${result.created}, promoted ${result.promoted}`,
    );
    for (const it of result.transitionedIssues) {
      console.log(
        `  → ${it.identifier ?? it.externalId} → ${it.to}  ${it.title}`,
      );
    }
    for (const it of result.createdIssues) {
      console.log(
        `  + ${it.identifier ?? it.externalId} (created)  ${it.title}`,
      );
    }
    for (const it of result.promotedIssues) {
      console.log(
        `  ✓ ${it.identifier ?? it.externalId} → ${it.to}  ${it.title}`,
      );
    }
  } else if (subcommand === "release") {
    const version = cliArgs.slice(1).find((a) => !a.startsWith("--"));
    if (!version) {
      console.error(
        "Usage: autoloop-linear-sync release <version> [--no-archive]",
      );
      process.exit(1);
    }
    const result = await release(
      adapter,
      syncConfig,
      stateFile,
      version,
      syncConfig.linear?.repoLabel,
      noteCtx,
      { archive: !cliArgs.includes("--no-archive") },
    );
    console.log(
      `autoloop-linear-sync release: promoted ${result.promoted} issue(s) to Done`,
    );
    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    for (const it of result.promotedIssues) {
      console.log(`  ✓ ${it.identifier ?? it.externalId} → Done`);
      // Delete the merged per-issue branch (local, safe: -d only removes if merged;
      // never the current branch).
      if (it.branchName && it.branchName !== currentBranch) {
        const del = spawnSync("git", ["branch", "-d", it.branchName], {
          encoding: "utf-8",
        });
        console.log(
          del.status === 0
            ? `    deleted merged branch ${it.branchName}`
            : `    kept ${it.branchName} (unmerged or absent)`,
        );
      }
    }
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`autoloop-linear-sync error: ${msg}`);
  process.exit(1);
});
