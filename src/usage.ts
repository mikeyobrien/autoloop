import { joinCsv } from "./utils.js";
import * as chains from "./chains.js";

export function printUsage(): void {
  console.log("autoloops-ts — autonomous LLM loop harness");
  console.log("");
  console.log("Usage:");
  console.log("  autoloops-ts run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("  autoloops-ts emit <topic> [summary]");
  console.log("  autoloops-ts inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
  console.log("  autoloops-ts memory <list|add|remove> [args]");
  console.log("  autoloops-ts list");
  console.log("  autoloops-ts loops [--all]");
  console.log("  autoloops-ts loops show <run-id>");
  console.log("  autoloops-ts loops artifacts <run-id>");
  console.log("  autoloops-ts loops watch <run-id>");
  console.log("  autoloops-ts loops health [--verbose]");
  console.log("  autoloops-ts chain <list|run> [args]");
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
}

export function printRunUsage(): void {
  console.log("Usage: autoloops-ts run <preset-name|preset-dir> [prompt...] [flags]");
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
  console.log("");
  console.log("Examples:");
  console.log("  autoloops-ts run autocode");
  console.log('  autoloops-ts run autocode "Fix the login bug"');
  console.log('  autoloops-ts run presets/autoqa "QA recent changes"');
  console.log('  autoloops-ts run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloops-ts list' to see all available presets.");
}

export function printEmitUsage(): void {
  console.log("Usage:");
  console.log("  autoloops-ts emit <topic> [summary]");
}

export function printInspectUsage(): void {
  console.log("Usage:");
  console.log("  autoloops-ts inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
  console.log("");
  console.log("Defaults when --format is omitted:");
  console.log("  scratchpad, prompt, memory, coordination, chain, metrics -> terminal");
  console.log("  output -> text");
  console.log("  journal -> json");
  console.log("");
  console.log("Artifacts:");
  console.log("  scratchpad, prompt, output, journal, memory, coordination, chain, metrics");
}

export function printMemoryUsage(): void {
  console.log("Usage:");
  console.log("  autoloops-ts memory list [project-dir]");
  console.log("  autoloops-ts memory status [project-dir]");
  console.log("  autoloops-ts memory find <pattern...>");
  console.log("  autoloops-ts memory add learning <text...>");
  console.log("  autoloops-ts memory add preference <category> <text...>");
  console.log("  autoloops-ts memory add meta <key> <value...>");
  console.log("  autoloops-ts memory remove <id> [reason...]");
}

export function printMemoryAddUsage(): void {
  console.log("Usage:");
  console.log("  autoloops-ts memory add learning <text...>");
  console.log("  autoloops-ts memory add preference <category> <text...>");
  console.log("  autoloops-ts memory add meta <key> <value...>");
  console.log("");
  console.log("Memory helpers:");
  console.log("  autoloops-ts memory status [project-dir]");
  console.log("  autoloops-ts memory find <pattern...>");
  console.log("  autoloops-ts memory remove <id> [reason...]");
}

export function missingPresetError(): void {
  console.log("error: missing required preset argument");
  console.log("");
  console.log("Usage: autoloops-ts run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("");
  console.log("Examples:");
  console.log("  autoloops-ts run autocode");
  console.log('  autoloops-ts run autocode "Fix the login bug"');
  console.log('  autoloops-ts run presets/autoqa "QA recent changes"');
  console.log('  autoloops-ts run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloops-ts list' to see all available presets.");
}

export function unknownPresetError(name: string): void {
  console.log("error: preset `" + name + "` not found");
  console.log("");
  console.log("The argument `" + name + "` is not a valid preset name or directory.");
  console.log("A preset must be a directory containing autoloops.toml (or autoloops.conf),");
  console.log("or a bundled preset name.");
  console.log("");
  console.log("Available presets: " + joinCsv(chains.listKnownPresets()));
  console.log("Run 'autoloops-ts list' to see all available presets.");
  console.log("");
  console.log("Usage: autoloops-ts run <preset-name|preset-dir> [prompt...] [flags]");
}
