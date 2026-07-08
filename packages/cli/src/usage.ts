import { joinCsv } from "@mobrienv/autoloop-core";
import * as chains from "./chains.js";
import { EXIT_USAGE, fail } from "./cli/fail.js";
import { didYouMean } from "./cli/suggest.js";

export function printUsage(): void {
  console.log("autoloop — autonomous LLM loop harness");
  console.log("");
  console.log("Usage:");
  console.log("  autoloop run <preset-name|preset-dir> [prompt...] [flags]");
  console.log(
    "  autoloop resume <run-id> [--add-iterations N] [-b <backend>] [-v]",
  );
  console.log(
    "  autoloop init [--preset <name>|--single-file <file.toml>] [dir]",
  );
  console.log("  autoloop emit <topic> [summary]");
  console.log(
    "  autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv|graph>]",
  );
  console.log(
    "  autoloop memory <list|status|find|add|remove|compact|prune> [args]",
  );
  console.log("  autoloop task <add|complete|update|remove|list> [args]");
  console.log("  autoloop list [--json]");
  console.log("  autoloop loops [--all] [--json]");
  console.log("  autoloop loops show <run-id>");
  console.log("  autoloop loops artifacts <run-id>");
  console.log("  autoloop loops watch <run-id>");
  console.log("  autoloop loops health [--verbose] [--json]");
  console.log(
    "  autoloop control <show|capabilities|interrupt|guide> <run-id>",
  );
  console.log("  autoloop chain list [project-dir]");
  console.log(
    "  autoloop chain run <name> [project-dir] [prompt...] [--dry-run] [--json]",
  );
  console.log("  autoloop runs clean [--max-age <days>]");
  console.log("  autoloop stats [project-dir] [--json]");
  console.log("  autoloop verify [project-dir] [run-id] [--json]");
  console.log("  autoloop doctor [project-dir] [--json]");
  console.log("  autoloop preset promote <source.toml> <name>");
  console.log("  autoloop worktree <list|show|diff|merge|clean> [args]");
  console.log("  autoloop config <show|set|unset|path> [args]");
  console.log(
    "  autoloop hooks <list|show|validate|clear-suspend> [project-dir] [--json]",
  );
  console.log("  autoloop dashboard [--port <port>]");
  console.log("  autoloop kanban [--port <port>]");
  console.log("  autoloop acp [--project-dir <dir>]");
  console.log("");
  console.log("Agent / automation surfaces:");
  console.log(
    "  autoloop triage [--json]      One-call status: runs, health, doctor, next commands",
  );
  console.log(
    "  autoloop capabilities         Machine-readable contract (commands, flags, exit codes)",
  );
  console.log(
    "  autoloop robot-docs           Paste-ready agent handbook for this CLI",
  );
  console.log(
    "  autoloop <cmd> --json         Structured output: list, loops, stats, doctor, chain run",
  );
  console.log("");
  console.log(
    "Exit codes: 0 success · 1 user-input error · 2 environment/state error",
  );
  console.log("");
  console.log(
    "The preset argument is required for `run`. It must be a bundled preset",
  );
  console.log(
    "name (e.g. autocode, autoqa) or a path to a directory containing",
  );
  console.log("autoloops.toml. Use `.` to run from the current directory.");
  console.log("");
  console.log("Flags:");
  console.log("  -h, --help       Show this help");
  console.log("  -V, --version    Print the autoloop version");
  console.log("  -v, --verbose    Set log level to debug");
  console.log(
    "  -b, --backend    Override backend (claude-sdk, pi, kiro, hermes[:profile], claude-agent-acp, acp:<provider>:<cmd>, or a command)",
  );
  console.log(
    "  --max-iterations <n>  Override event_loop.max_iterations for this run",
  );
  console.log("  -i, --iterations <n>  Alias for --max-iterations");
  console.log(
    "  --set key=value       Override any config key for this run; repeatable",
  );
  console.log(
    "  -p, --preset     Resolve a bundled preset name or custom preset dir",
  );
  console.log(
    "  --preset-file <path>  Run from an explicit single-file (.toml) preset",
  );
  console.log(
    "  --chain          Run an inline chain (comma-separated presets)",
  );
  console.log(
    "  --profile <spec> Activate a profile (repo:<name> or user:<name>), repeatable",
  );
  console.log(
    "  --no-default-profiles  Suppress config-defined default profiles",
  );
  console.log("");
  console.log("Developer Workflow:");
  console.log("  npm run build        Type-check and compile (tsc)");
  console.log("  npm test             Run the test suite (vitest)");
  console.log("  npm run test:watch   Run tests in watch mode");
  console.log("  bin/install-hooks    Install git pre-commit/pre-push hooks");
}

export function printRunUsage(): void {
  console.log(
    "Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]",
  );
  console.log("");
  console.log(
    "The preset argument is required. It must be a bundled preset name",
  );
  console.log("(e.g. autocode, autoqa) or a path to a directory containing");
  console.log("autoloops.toml. Use `.` to run from the current directory.");
  console.log("");
  console.log("Flags:");
  console.log("  -h, --help       Show this help");
  console.log("  -v, --verbose    Set log level to debug");
  console.log(
    "  -b, --backend    Override backend (claude-sdk, pi, kiro, hermes[:profile], claude-agent-acp, acp:<provider>:<cmd>, or a command)",
  );
  console.log(
    "  --max-iterations <n>  Override event_loop.max_iterations for this run",
  );
  console.log("  -i, --iterations <n>  Alias for --max-iterations");
  console.log(
    "  --set key=value       Override any config key for this run; repeatable",
  );
  console.log(
    "  -p, --preset     Resolve a bundled preset name or custom preset dir",
  );
  console.log(
    "  --preset-file <path>  Run from an explicit single-file (.toml) preset",
  );
  console.log(
    "  --chain          Run an inline chain (comma-separated presets)",
  );
  console.log(
    "  --profile <spec> Activate a profile (repo:<name> or user:<name>), repeatable",
  );
  console.log(
    "  --no-default-profiles  Suppress config-defined default profiles",
  );
  console.log("");
  console.log("Isolation:");
  console.log("  --worktree             Run in an isolated git worktree");
  console.log(
    "  --no-worktree          Disable worktree isolation (use run-scoped)",
  );
  console.log(
    "  --merge-strategy <s>   Merge strategy: squash (default), merge, rebase",
  );
  console.log("  --automerge            Auto-merge worktree on completion");
  console.log("  --keep-worktree        Keep worktree after run completes");
  console.log(
    "  --events <path>        Append the NDJSON LoopEvent stream to <path>",
  );
  console.log("");
  console.log("Dynamic workflows (architect-generated presets):");
  console.log(
    "  --architect, --dynamic Route an objective (no preset name) through the",
  );
  console.log(
    "                         autoarchitect preset, which designs a bespoke",
  );
  console.log(
    "                         single-file preset and auto-chains into running it",
  );
  console.log(
    "  --ultra                --architect at maximum intensity (exhaustive fan-out)",
  );
  console.log(
    "  --budget <usd>         Advisory cost target for the architect; also sets",
  );
  console.log(
    "                         the hard event_loop.max_cost_usd ceiling",
  );
  console.log(
    "  --no-resume            Relaunch every fan-out stage branch instead of",
  );
  console.log(
    "                         reusing journaled branch results from a prior attempt",
  );
  console.log("");
  console.log("Examples:");
  console.log("  autoloop run autocode");
  console.log('  autoloop run autocode "Fix the login bug"');
  console.log(
    '  autoloop run autocode --max-iterations 250 "Fix the login bug"',
  );
  console.log(
    '  autoloop run autocode --set backend.timeout_ms=900000 "Fix slowly"',
  );
  console.log('  autoloop run presets/autoqa "QA recent changes"');
  console.log('  autoloop run . "Run from current directory"');
  console.log(
    '  autoloop run --ultra "Add rate limiting to the API" --budget 5',
  );
  console.log(
    '  autoloop run --preset-file ./preset.toml "objective"  # single-file preset',
  );
  console.log("");
  console.log("Run 'autoloop list' to see all available presets.");
}

export function printEmitUsage(): void {
  console.log("Usage:");
  console.log("  autoloop emit <topic> [summary]");
}

export function printInspectUsage(): void {
  console.log("Usage:");
  console.log(
    "  autoloop inspect <artifact> [selector] [project-dir] [--format <md|terminal|text|json|csv|graph>]",
  );
  console.log("");
  console.log("Artifacts:");
  console.log("");
  console.log("  Artifact       Selector      Formats                 Default");
  console.log(
    "  ─────────────  ────────────  ──────────────────────  ────────",
  );
  console.log(
    "  scratchpad     —             md, terminal            terminal",
  );
  console.log(
    "  prompt         <iteration>   md, terminal            terminal",
  );
  console.log("  output         <iteration>   text                    text");
  console.log(
    "  journal        [--topic/--iter/--all-runs/--json]  terminal, json  terminal",
  );
  console.log("  artifacts      [--run]       terminal, json      terminal");
  console.log(
    "  memory         —             md, terminal, json      terminal",
  );
  console.log(
    "  tasks          —             md, terminal            terminal",
  );
  console.log(
    "  coordination   —             md, terminal            terminal",
  );
  console.log(
    "  chain          —             md, terminal            terminal",
  );
  console.log(
    "  metrics        [run_id]      md, terminal, csv, json terminal",
  );
  console.log(
    "  usage          [run_id]      terminal, json          terminal",
  );
  console.log(
    "  progress       [run_id]      terminal, json          terminal",
  );
  console.log(
    "  diff           <run> <a> <b> terminal, json          terminal",
  );
  console.log(
    "  profiles       —             terminal                terminal",
  );
  console.log(
    "  topology       —             terminal, json, graph   terminal",
  );
  console.log("");
  console.log("Examples:");
  console.log("  autoloop inspect scratchpad");
  console.log("  autoloop inspect prompt 5 --format md");
  console.log("  autoloop inspect topology");
  console.log("  autoloop inspect topology --format graph");
  console.log("  autoloop inspect topology --format json");
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
  console.log("  autoloop memory compact [project-dir]");
  console.log("  autoloop memory prune --max-age <days> [project-dir]");
}

export function printTaskUsage(): void {
  console.log("Usage:");
  console.log(
    "  autoloop task add [--priority|-p <high|normal|low>] [--soft] <text...>",
  );
  console.log("  autoloop task complete <id>");
  console.log("  autoloop task update <id> <text...>");
  console.log("  autoloop task remove <id> [reason...]");
  console.log("  autoloop task list [project-dir]");
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
  fail(
    [
      "error: missing required preset argument",
      "",
      "Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]",
      "",
      "Examples:",
      "  autoloop run autocode",
      '  autoloop run autocode "Fix the login bug"',
      '  autoloop run autocode --max-iterations 250 "Fix the login bug"',
      '  autoloop run autocode --set backend.timeout_ms=900000 "Fix slowly"',
      '  autoloop run presets/autoqa "QA recent changes"',
      '  autoloop run . "Run from current directory"',
      "",
      "Run 'autoloop list' to see all available presets.",
    ],
    EXIT_USAGE,
  );
}

export function unknownPresetError(name: string): void {
  const lines = [`error: preset \`${name}\` not found`];
  const hint = didYouMean(name, chains.listKnownPresets());
  if (hint) lines.push(hint);
  lines.push(
    "",
    `The argument \`${name}\` is not a valid preset name or directory.`,
    "A preset must be a directory containing autoloops.toml (or autoloops.conf),",
    "or a bundled preset name.",
    "",
    `Available presets: ${joinCsv(chains.listKnownPresets())}`,
    "Run 'autoloop list' to see all available presets.",
    "",
    "Usage: autoloop run <preset-name|preset-dir> [prompt...] [flags]",
  );
  fail(lines, EXIT_USAGE);
}
