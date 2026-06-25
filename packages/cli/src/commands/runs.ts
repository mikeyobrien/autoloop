import { join } from "node:path";
import { isProcessAlive, parseFlag } from "@mobrienv/autoloop-core";
import { cleanRunScopedDirs } from "@mobrienv/autoloop-core/isolation/run-scope";
import { activeRuns } from "@mobrienv/autoloop-core/registry/read";
import { appendRegistryEntry } from "@mobrienv/autoloop-core/registry/update";

const DEFAULT_MAX_AGE_DAYS = 7;

export function dispatchRuns(args: string[]): void {
  const projectDir = process.env.AUTOLOOP_PROJECT_DIR || ".";
  const stateDir = join(projectDir, ".autoloop");

  const sub = args[0] ?? "";

  if (sub === "--help" || sub === "-h") {
    printRunsUsage();
    return;
  }

  if (sub === "clean") {
    doClean(stateDir, args.slice(1));
    return;
  }

  if (sub === "") {
    printRunsUsage();
    return;
  }

  console.log(`Unknown runs subcommand: ${sub}`);
  printRunsUsage();
}

// Mark runs still recorded "running" whose OS process is gone as "stopped" — the rot
// `doctor` detects but cannot fix. Append-only: writes a corrected status line.
function reconcileStuckRuns(registryPath: string): string[] {
  const stuck = activeRuns(registryPath).filter(
    (r) => r.pid == null || !isProcessAlive(r.pid),
  );
  for (const r of stuck) {
    appendRegistryEntry(registryPath, {
      ...r,
      status: "stopped",
      stop_reason: "reconciled: process gone",
    });
  }
  return stuck.map((r) => r.run_id);
}

function doClean(stateDir: string, args: string[]): void {
  const registryPath = join(stateDir, "registry.jsonl");

  if (args.includes("--reconcile")) {
    const reconciled = reconcileStuckRuns(registryPath);
    console.log(
      reconciled.length > 0
        ? `Reconciled ${reconciled.length} stuck run(s) (process gone): ${reconciled.join(", ")}`
        : "No stuck runs to reconcile.",
    );
  }

  const activeRunIds = new Set(activeRuns(registryPath).map((r) => r.run_id));

  const maxAgeStr = parseFlag(args, "--max-age");
  const maxAgeDays =
    maxAgeStr !== undefined ? Number(maxAgeStr) : DEFAULT_MAX_AGE_DAYS;

  if (Number.isNaN(maxAgeDays) || maxAgeDays < 0) {
    console.log("error: --max-age must be a non-negative number (days)");
    process.exitCode = 1;
    return;
  }

  const removed = cleanRunScopedDirs(stateDir, { activeRunIds, maxAgeDays });

  if (removed.length === 0) {
    console.log("No run-scoped directories to clean.");
  } else {
    console.log(
      `Cleaned ${removed.length} run directory(s): ${removed.join(", ")}`,
    );
  }
}

function printRunsUsage(): void {
  console.log("Usage:");
  console.log(
    "  autoloop runs clean [--max-age <days>] [--reconcile]   Remove stale run-scoped directories",
  );
  console.log("");
  console.log("Options:");
  console.log(
    "  --max-age <days>   Only remove directories older than N days (default: 7)",
  );
  console.log(
    "  --reconcile        Mark runs still 'running' whose process is gone as stopped",
  );
}
