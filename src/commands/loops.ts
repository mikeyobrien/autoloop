import { join } from "node:path";
import { listRuns } from "../loops/list.js";
import { showRun, showArtifacts } from "../loops/show.js";
import { watchRun } from "../loops/watch.js";
import { healthSummary } from "../loops/health.js";

export function dispatchLoops(args: string[]): void {
  const projectDir = resolveProjectDir();
  const registryPath = join(projectDir, ".autoloop", "registry.jsonl");

  if (args.length === 0) {
    console.log(listRuns(registryPath, false));
    return;
  }

  const first = args[0];

  if (first === "--help" || first === "-h") {
    printLoopsUsage();
    return;
  }

  if (first === "--all") {
    console.log(listRuns(registryPath, true));
    return;
  }

  if (first === "show") {
    const runId = args[1];
    if (!runId) {
      console.log("Usage: autoloop loops show <run-id>");
      return;
    }
    console.log(showRun(registryPath, runId));
    return;
  }

  if (first === "artifacts") {
    const runId = args[1];
    if (!runId) {
      console.log("Usage: autoloop loops artifacts <run-id>");
      return;
    }
    console.log(showArtifacts(registryPath, runId));
    return;
  }

  if (first === "watch") {
    const runId = args[1];
    if (!runId) {
      console.log("Usage: autoloop loops watch <run-id>");
      return;
    }
    watchRun(registryPath, runId).catch((err: unknown) => {
      console.error("Watch error:", err);
      process.exitCode = 1;
    });
    return;
  }

  if (first === "health") {
    const verbose = args.includes("--verbose") || args.includes("-v");
    console.log(healthSummary(registryPath, verbose));
    return;
  }

  console.log("Unknown loops subcommand: " + first);
  printLoopsUsage();
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
  return process.env["AUTOLOOP_PROJECT_DIR"] || ".";
}
