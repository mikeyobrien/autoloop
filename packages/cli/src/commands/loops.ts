import { join } from "node:path";
import { healthSummary } from "../loops/health.js";
import {
  artifactsJson,
  healthJson,
  type JsonResult,
  listRunsJson,
  showRunJson,
} from "../loops/json.js";
import { listRuns } from "../loops/list.js";
import { showArtifacts, showRun } from "../loops/show.js";
import { watchRun } from "../loops/watch.js";

export function dispatchLoops(args: string[]): void {
  const projectDir = resolveProjectDir();
  const stateDir = join(projectDir, ".autoloop");
  const json = args.includes("--json");
  const rest = json ? args.filter((a) => a !== "--json") : args;

  if (rest.length === 0) {
    console.log(
      json ? listRunsJson(stateDir, false) : listRuns(stateDir, false),
    );
    return;
  }

  const first = rest[0];

  if (first === "--help" || first === "-h") {
    printLoopsUsage();
    return;
  }

  if (first === "--all") {
    console.log(json ? listRunsJson(stateDir, true) : listRuns(stateDir, true));
    return;
  }

  if (first === "show") {
    const runId = rest[1];
    if (!runId) {
      console.log("Usage: autoloop loops show <run-id>");
      return;
    }
    if (json) {
      printJsonResult(showRunJson(stateDir, runId));
      return;
    }
    console.log(showRun(stateDir, runId));
    return;
  }

  if (first === "artifacts") {
    const runId = rest[1];
    if (!runId) {
      console.log("Usage: autoloop loops artifacts <run-id>");
      return;
    }
    if (json) {
      printJsonResult(artifactsJson(stateDir, runId));
      return;
    }
    console.log(showArtifacts(stateDir, runId));
    return;
  }

  if (first === "watch") {
    const runId = rest[1];
    if (!runId) {
      console.log("Usage: autoloop loops watch <run-id>");
      return;
    }
    watchRun(stateDir, runId).catch((err: unknown) => {
      console.error("Watch error:", err);
      process.exitCode = 1;
    });
    return;
  }

  if (first === "health") {
    if (json) {
      console.log(healthJson(stateDir));
      return;
    }
    const verbose = rest.includes("--verbose") || rest.includes("-v");
    console.log(healthSummary(stateDir, verbose));
    return;
  }

  console.log(`Unknown loops subcommand: ${first}`);
  printLoopsUsage();
}

function printJsonResult(result: JsonResult): void {
  console.log(result.output);
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

function printLoopsUsage(): void {
  console.log("Usage:");
  console.log("  autoloop loops                    List active runs");
  console.log("  autoloop loops --all               List all runs");
  console.log("  autoloop loops show <run-id>       Show run details");
  console.log("  autoloop loops artifacts <run-id>  Show artifact paths");
  console.log("  autoloop loops watch <run-id>      Watch a run live");
  console.log("  autoloop loops health [--verbose]  Health summary");
}

function resolveProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
