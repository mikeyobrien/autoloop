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
import type { GhSyncConfig } from "./adapter.js";
import { GhAdapter } from "./adapter.js";

/**
 * Resolve the state-root directory for issue-sync files.
 *
 * gh-sync runs as a standalone hook binary and cannot load the full autoloop
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

function loadIssueSyncConfig(projectDir: string): IssueSyncConfig {
  const tomlPath = join(stateDirFor(projectDir), "issue-sync.toml");
  if (!existsSync(tomlPath)) {
    throw new Error(
      `No issue-sync.toml found under ${stateDirFor(projectDir)}`,
    );
  }
  const raw = readFileSync(tomlPath, "utf-8");
  const repoMatch = raw.match(/^\s*repo\s*=\s*"([^"]+)"/m);
  const labelMatch = raw.match(/^\s*queued_label\s*=\s*"([^"]+)"/m);
  return {
    tracker: "github",
    github: {
      repo: repoMatch?.[1] ?? "",
      queuedLabel: labelMatch?.[1] ?? "autoloop:queued",
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
    console.log("Usage: autoloop-gh-sync <pull|push|release> [options]");
    console.log(
      "  pull                       Pull GitHub issues into the queue",
    );
    console.log(
      "  push [--release] [--no-archive]    Move completed tasks' issues to In Review;",
    );
    console.log(
      "                                     --release also promotes In Review → Done",
    );
    console.log(
      "  release <version> [--no-archive]   Promote In-Review issues to Done",
    );
    process.exit(0);
  }

  const config = loadIssueSyncConfig(projectDir);
  const adapter = new GhAdapter({
    repo: config.github?.repo ?? "",
    queuedLabel: config.github?.queuedLabel,
  } satisfies GhSyncConfig);
  const tasksApi = createJsonlTasksApi(tasksFileFor(projectDir));
  const noteCtx = {
    runId: runId || undefined,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  };

  if (subcommand === "pull") {
    const result = await pull(adapter, config, tasksApi, stateFile);
    console.log(`autoloop-gh-sync pull: added ${result.added} issue(s)`);
    for (const it of result.addedIssues) {
      console.log(`  + ${it.identifier ?? it.externalId}  ${it.title}`);
    }
  } else if (subcommand === "push") {
    const result = await push(adapter, config, tasksApi, stateFile, noteCtx, {
      release: cliArgs.includes("--release"),
      archive: !cliArgs.includes("--no-archive"),
    });
    console.log(
      `autoloop-gh-sync push: transitioned ${result.transitioned}, created ${result.created}, promoted ${result.promoted}`,
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
      console.error("Usage: autoloop-gh-sync release <version> [--no-archive]");
      process.exit(1);
    }
    const result = await release(
      adapter,
      config,
      stateFile,
      version,
      undefined,
      noteCtx,
      { archive: !cliArgs.includes("--no-archive") },
    );
    console.log(
      `autoloop-gh-sync release: promoted ${result.promoted} issue(s) to Done`,
    );
    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    for (const it of result.promotedIssues) {
      console.log(`  ✓ ${it.identifier ?? it.externalId} → Done`);
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
  console.error(`autoloop-gh-sync error: ${msg}`);
  process.exit(1);
});
