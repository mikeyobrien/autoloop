import { joinCsv } from "./utils.js";
import * as chains from "./chains.js";

export function printUsage(): void {
  console.log("autoloop — autonomous LLM loop harness");
  console.log("");
  console.log("Usage:");
  console.log("  autoloop run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("  autoloop emit <topic> [summary]");
  console.log("  autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
  console.log("  autoloop memory <list|add|remove> [args]");
  console.log("  autoloop list");
  console.log("  autoloop loops [--all]");
  console.log("  autoloop loops show <run-id>");
  console.log("  autoloop loops artifacts <run-id>");
  console.log("  autoloop loops watch <run-id>");
  console.log("  autoloop loops health [--verbose]");
  console.log("  autoloop chain <list|run> [args]");
  console.log("  autoloop worktree <list|show|merge|clean> [args]");
  console.log("  autoloop config <show|set|unset|path> [args]");
  console.log("  autoloop dashboard [--port <port>]");
  console.log("");
  console.log("The preset argument is required for `run`. It must be a bundled preset");
  console.log("name (e.g. autocode, autoqa) or a path to a directory containing");
  console.log("autoloops.toml. Use `.` to run from the current directory.");
  console.log("");
  console.log("Flags:");
  console.log("  -h, --help       Show this help");
  console.log("  -v, --verbose    Set log level to debug");
  console.log("  -b, --backend    Override backend command");
  console.log("  -p, --preset     Resolve a bundled preset name or custom preset dir");
  console.log("  --chain          Run an inline chain (comma-separated presets)");
  console.log("  --profile <spec> Activate a profile (repo:<name> or user:<name>), repeatable");
  console.log("  --no-default-profiles  Suppress config-defined default profiles");
  console.log("");
  console.log("Developer Workflow:");
  console.log("  npm run build        Type-check and compile (tsc)");
  console.log("  npm test             Run the test suite (vitest)");
  console.log("  npm run test:watch   Run tests in watch mode");
  console.log("  bin/install-hooks    Install git pre-commit/pre-push hooks");
}

export function printRunUsage(): void {
  console.log("Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("");
  console.log("The preset argument is required. It must be a bundled preset name");
  console.log("(e.g. autocode, autoqa) or a path to a directory containing");
  console.log("autoloops.toml. Use `.` to run from the current directory.");
  console.log("");
  console.log("Flags:");
  console.log("  -h, --help       Show this help");
  console.log("  -v, --verbose    Set log level to debug");
  console.log("  -b, --backend    Override backend command");
  console.log("  -p, --preset     Resolve a bundled preset name or custom preset dir");
  console.log("  --chain          Run an inline chain (comma-separated presets)");
  console.log("  --profile <spec> Activate a profile (repo:<name> or user:<name>), repeatable");
  console.log("  --no-default-profiles  Suppress config-defined default profiles");
  console.log("");
  console.log("Isolation:");
  console.log("  --worktree             Run in an isolated git worktree");
  console.log("  --no-worktree          Force shared checkout (disable worktree)");
  console.log("  --merge-strategy <s>   Merge strategy: squash (default), merge, rebase");
  console.log("  --automerge            Auto-merge worktree on completion");
  console.log("  --keep-worktree        Keep worktree after run completes");
  console.log("");
  console.log("Examples:");
  console.log("  autoloop run autocode");
  console.log('  autoloop run autocode "Fix the login bug"');
  console.log('  autoloop run presets/autoqa "QA recent changes"');
  console.log('  autoloop run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloop list' to see all available presets.");
}

export function printEmitUsage(): void {
  console.log("Usage:");
  console.log("  autoloop emit <topic> [summary]");
}

export function printInspectUsage(): void {
  console.log("Usage:");
  console.log("  autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
  console.log("");
  console.log("Defaults when --format is omitted:");
  console.log("  scratchpad, prompt, memory, coordination, chain, metrics -> terminal");
  console.log("  output -> text");
  console.log("  journal -> json");
  console.log("");
  console.log("Artifacts:");
  console.log("  scratchpad, prompt, output, journal, memory, coordination, chain, metrics, profiles");
}

export function printMemoryUsage(): void {
  console.log("Usage:");
  console.log("  autoloop memory list [project-dir]");
  console.log("  autoloop memory status [project-dir]");
  console.log("  autoloop memory find <pattern...>");
  console.log("  autoloop memory add learning <text...>");
  console.log("  autoloop memory add preference <category> <text...>");
  console.log("  autoloop memory add meta <key> <value...>");
  console.log("  autoloop memory remove <id> [reason...]");
}

export function printMemoryAddUsage(): void {
  console.log("Usage:");
  console.log("  autoloop memory add learning <text...>");
  console.log("  autoloop memory add preference <category> <text...>");
  console.log("  autoloop memory add meta <key> <value...>");
  console.log("");
  console.log("Memory helpers:");
  console.log("  autoloop memory status [project-dir]");
  console.log("  autoloop memory find <pattern...>");
  console.log("  autoloop memory remove <id> [reason...]");
}

export function missingPresetError(): void {
  console.log("error: missing required preset argument");
  console.log("");
  console.log("Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("");
  console.log("Examples:");
  console.log("  autoloop run autocode");
  console.log('  autoloop run autocode "Fix the login bug"');
  console.log('  autoloop run presets/autoqa "QA recent changes"');
  console.log('  autoloop run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloop list' to see all available presets.");
}

export function unknownPresetError(name: string): void {
  console.log("error: preset `" + name + "` not found");
  console.log("");
  console.log("The argument `" + name + "` is not a valid preset name or directory.");
  console.log("A preset must be a directory containing autoloops.toml (or autoloops.conf),");
  console.log("or a bundled preset name.");
  console.log("");
  console.log("Available presets: " + joinCsv(chains.listKnownPresets()));
  console.log("Run 'autoloop list' to see all available presets.");
  console.log("");
  console.log("Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]");
}
