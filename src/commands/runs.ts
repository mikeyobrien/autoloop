import { join } from "node:path";
import { cleanRunScopedDirs } from "../isolation/run-scope.js";
import { activeRuns } from "../registry/read.js";
import { parseFlag } from "../utils.js";

const DEFAULT_MAX_AGE_DAYS = 7;

export function dispatchRuns(args: string[]): void {
  const projectDir = process.env["AUTOLOOP_PROJECT_DIR"] || ".";
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

  console.log("Unknown runs subcommand: " + sub);
  printRunsUsage();
}

function doClean(stateDir: string, args: string[]): void {
  const registryPath = join(stateDir, "registry.jsonl");
  const activeRunIds = new Set(activeRuns(registryPath).map(r => r.run_id));

  const maxAgeStr = parseFlag(args, "--max-age");
  const maxAgeDays = maxAgeStr !== undefined ? Number(maxAgeStr) : DEFAULT_MAX_AGE_DAYS;

  if (Number.isNaN(maxAgeDays) || maxAgeDays < 0) {
    console.log("error: --max-age must be a non-negative number (days)");
    process.exitCode = 1;
    return;
  }

  const removed = cleanRunScopedDirs(stateDir, { activeRunIds, maxAgeDays });

  if (removed.length === 0) {
    console.log("No run-scoped directories to clean.");
  } else {
    console.log(`Cleaned ${removed.length} run directory(s): ${removed.join(", ")}`);
  }
}

function printRunsUsage(): void {
  console.log("Usage:");
  console.log("  autoloop runs clean [--max-age <days>]    Remove stale run-scoped directories");
  console.log("");
  console.log("Options:");
  console.log("  --max-age <days>   Only remove directories older than N days (default: 7)");
}

