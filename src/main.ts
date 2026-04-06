import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import * as harness from "./harness/index.js";
import { printUsage, printEmitUsage } from "./usage.js";
import { dispatchRun } from "./commands/run.js";
import { dispatchMemory } from "./commands/memory.js";
import { dispatchChain } from "./commands/chain.js";
import { dispatchInspect } from "./commands/inspect.js";
import { dispatchList } from "./commands/list.js";
import { dispatchPiAdapter } from "./commands/pi-adapter.js";
import { dispatchLoops } from "./commands/loops.js";
import { dispatchWorktree } from "./commands/worktree.js";
import { dispatchConfig } from "./commands/config.js";

function main(): void {
  const argv = process.argv;
  const args = runtimeArgv(argv);
  dispatch(args, argv);
}

function dispatch(args: string[], argv: string[]): void {
  const cmd = args[0] ?? "";
  const selfCmd = selfCommand(argv);
  const bundleRoot = resolveBundleRoot(argv);

  switch (cmd) {
    case "--help":
    case "-h":
      printUsage();
      return;
    case "run":
      dispatchRun(args.slice(1), argv, bundleRoot, selfCmd);
      return;
    case "emit":
      if (!args[1] || args[1] === "--help" || args[1] === "-h") { printEmitUsage(); return; }
      harness.emit(resolveRuntimeProjectDir(), args[1], args.slice(2).join(" "));
      return;
    case "list":
      dispatchList(args.slice(1), bundleRoot);
      return;
    case "loops":
      dispatchLoops(args.slice(1));
      return;
    case "inspect":
      dispatchInspect(args.slice(1));
      return;
    case "pi-adapter":
      dispatchPiAdapter(args.slice(1));
      return;
    case "branch-run":
      harness.runParallelBranchCli(args[1], args[2], selfCmd);
      return;
    case "memory":
      dispatchMemory(args.slice(1));
      return;
    case "worktree":
      dispatchWorktree(args.slice(1));
      return;
    case "chain":
      dispatchChain(args.slice(1), selfCmd);
      return;
    case "config":
      dispatchConfig(args.slice(1));
      return;
    default:
      dispatchRun(args, argv, bundleRoot, selfCmd);
  }
}

function resolveRuntimeProjectDir(): string {
  return process.env["MINILOOPS_PROJECT_DIR"] || ".";
}

function runtimeArgv(argv: string[]): string[] {
  // argv[0] is node, argv[1] is script, rest is user args
  const userArgs = argv.slice(2);
  if (userArgs.length === 0) return [];

  // If first arg is a CLI command, use as-is
  if (isCliCommand(userArgs[0])) return userArgs;

  // For "autoloop run <project>" form, pass through
  if (userArgs[0] === "run" && userArgs.length >= 2) {
    return userArgs;
  }

  return userArgs;
}

function isCliCommand(value: string): boolean {
  return ["run", "emit", "inspect", "memory", "list", "loops", "chain", "pi-adapter", "branch-run", "worktree", "config", "--help", "-h"].includes(value);
}

function selfCommand(argv: string[]): string {
  // Return a command that re-invokes this program
  return "'" + resolve(argv[1] ?? "autoloop") + "'";
}

function resolveBundleRoot(argv: string[]): string {
  const envRoot = process.env["AUTOLOOPS_BUNDLE_ROOT"];
  if (envRoot) return envRoot;
  // Try to resolve from the script location
  const scriptPath = argv[1] ?? "";
  if (scriptPath) {
    // The bundle root is the directory containing the script's parent project
    const scriptDir = resolve(scriptPath, "..");
    const candidate = resolve(scriptDir, "..");
    if (existsSync(join(candidate, "presets"))) return candidate;
  }
  return ".";
}

main();
