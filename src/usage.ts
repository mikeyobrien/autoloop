import { joinCsv } from "./utils.js";
import * as chains from "./chains.js";

export function printUsage(): void {
  console.log("autoloops — autonomous LLM loop harness");
  console.log("");
  console.log("Usage:");
  console.log("  autoloops run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("  autoloops emit <topic> [summary]");
  console.log("  autoloops inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
  console.log("  autoloops memory <list|add|remove> [args]");
  console.log("  autoloops list");
  console.log("  autoloops chain <list|run> [args]");
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
  console.log("Usage: autoloops run <preset-name|preset-dir> [prompt...] [flags]");
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
  console.log("  autoloops run autocode");
  console.log('  autoloops run autocode "Fix the login bug"');
  console.log('  autoloops run presets/autoqa "QA recent changes"');
  console.log('  autoloops run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloops list' to see all available presets.");
}

export function printEmitUsage(): void {
  console.log("Usage:");
  console.log("  autoloops emit <topic> [summary]");
}

export function printInspectUsage(): void {
  console.log("Usage:");
  console.log("  autoloops inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv>]");
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
  console.log("  autoloops memory list [project-dir]");
  console.log("  autoloops memory status [project-dir]");
  console.log("  autoloops memory find <pattern...>");
  console.log("  autoloops memory add learning <text...>");
  console.log("  autoloops memory add preference <category> <text...>");
  console.log("  autoloops memory add meta <key> <value...>");
  console.log("  autoloops memory remove <id> [reason...]");
}

export function printMemoryAddUsage(): void {
  console.log("Usage:");
  console.log("  autoloops memory add learning <text...>");
  console.log("  autoloops memory add preference <category> <text...>");
  console.log("  autoloops memory add meta <key> <value...>");
  console.log("");
  console.log("Memory helpers:");
  console.log("  autoloops memory status [project-dir]");
  console.log("  autoloops memory find <pattern...>");
  console.log("  autoloops memory remove <id> [reason...]");
}

export function missingPresetError(): void {
  console.log("error: missing required preset argument");
  console.log("");
  console.log("Usage: autoloops run <preset-name|preset-dir> [prompt...] [flags]");
  console.log("");
  console.log("Examples:");
  console.log("  autoloops run autocode");
  console.log('  autoloops run autocode "Fix the login bug"');
  console.log('  autoloops run presets/autoqa "QA recent changes"');
  console.log('  autoloops run . "Run from current directory"');
  console.log("");
  console.log("Run 'autoloops list' to see all available presets.");
}

export function unknownPresetError(name: string): void {
  console.log("error: preset `" + name + "` not found");
  console.log("");
  console.log("The argument `" + name + "` is not a valid preset name or directory.");
  console.log("A preset must be a directory containing autoloops.toml (or autoloops.conf),");
  console.log("or a bundled preset name.");
  console.log("");
  console.log("Available presets: " + joinCsv(chains.listKnownPresets()));
  console.log("Run 'autoloops list' to see all available presets.");
  console.log("");
  console.log("Usage: autoloops run <preset-name|preset-dir> [prompt...] [flags]");
}
