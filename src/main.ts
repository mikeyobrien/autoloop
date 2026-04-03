import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import * as harness from "./harness/index.js";
import * as memory from "./memory.js";
import * as chains from "./chains.js";
import * as config from "./config.js";
import * as piAdapter from "./pi-adapter.js";
import { joinCsv } from "./utils.js";
import {
  printUsage,
  printRunUsage,
  printEmitUsage,
  printInspectUsage,
  printMemoryUsage,
  printMemoryAddUsage,
  missingPresetError,
  unknownPresetError,
} from "./usage.js";

function main(): void {
  const argv = process.argv;
  const args = runtimeArgv(argv);
  dispatch(args, argv);
}

function dispatch(args: string[], argv: string[]): void {
  const cmd = args[0] ?? "";

  switch (cmd) {
    case "--help":
    case "-h":
      printUsage();
      return;
    case "run":
      if (args[1] === "--help" || args[1] === "-h") { printRunUsage(); return; }
      dispatchRun(args.slice(1), argv);
      return;
    case "emit":
      if (!args[1] || args[1] === "--help" || args[1] === "-h") { printEmitUsage(); return; }
      harness.emit(resolveRuntimeProjectDir(), args[1], args.slice(2).join(" "));
      return;
    case "list":
      if (args[1] === "--help") { console.log("Usage: autoloops list\n\nLists all bundled presets."); return; }
      handleListPresets();
      return;
    case "inspect":
      if (!args[1] || args[1] === "--help" || args[1] === "-h") { printInspectUsage(); return; }
      handleInspect(args.slice(1));
      return;
    case "pi-adapter":
      piAdapter.run(args.slice(1));
      return;
    case "branch-run":
      harness.runParallelBranchCli(args[1], args[2], selfCommand(argv));
      return;
    case "memory":
      dispatchMemory(args.slice(1), argv);
      return;
    case "chain":
      dispatchChain(args.slice(1), argv);
      return;
    default:
      dispatchRun(args, argv);
  }
}

function dispatchRun(args: string[], argv: string[]): void {
  const options = parseRunArgs(args, resolveBundleRoot(argv));
  if (options.usageError) return;

  if (options.chain) {
    runInlineChain(options.chain, options.projectDir, selfCommand(argv), options);
    return;
  }

  harness.run(
    options.projectDir,
    normalizePrompt(options.prompt),
    selfCommand(argv),
    options,
  );
}

function dispatchMemory(args: string[], _argv: string[]): void {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list":
      console.log(memory.listProject(args[1] ?? resolveRuntimeProjectDir()));
      return;
    case "status":
      console.log(memory.statusProject(args[1] ?? resolveRuntimeProjectDir()));
      return;
    case "find":
      if (!args[1] || args[1] === "--help") { console.log("Usage: autoloops memory find <pattern...>"); return; }
      console.log(memory.findProject(resolveRuntimeProjectDir(), args.slice(1).join(" ")));
      return;
    case "add":
      dispatchMemoryAdd(args.slice(1));
      return;
    case "remove":
      if (!args[1] || args[1] === "--help") { console.log("Usage: autoloops memory remove <id> [reason...]"); return; }
      memory.remove(resolveRuntimeProjectDir(), args[1], args.slice(2).join(" ") || "manual");
      return;
    default:
      printMemoryUsage();
  }
}

function dispatchMemoryAdd(args: string[]): void {
  const kind = args[0] ?? "";

  switch (kind) {
    case "learning":
      if (!args[1] || args[1] === "--help") { console.log("Usage: autoloops memory add learning <text...>"); return; }
      memory.addLearning(resolveRuntimeProjectDir(), args.slice(1).join(" "), "manual");
      return;
    case "preference":
      if (!args[1] || args[1] === "--help") { console.log("Usage: autoloops memory add preference <category> <text...>"); return; }
      memory.addPreference(resolveRuntimeProjectDir(), args[1], args.slice(2).join(" "));
      return;
    case "meta":
      if (!args[1] || args[1] === "--help") { console.log("Usage: autoloops memory add meta <key> <value...>"); return; }
      memory.addMeta(resolveRuntimeProjectDir(), args[1], args.slice(2).join(" "));
      return;
    default:
      printMemoryAddUsage();
  }
}

function dispatchChain(args: string[], argv: string[]): void {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list": {
      const projectDir = args[1] ?? resolveRuntimeProjectDir();
      const chainsData = chains.load(projectDir);
      const chainList = chains.listChains(chainsData);
      if (chainList.length === 0) {
        console.log("No chains defined. Add [[chain]] sections to chains.toml.");
        return;
      }
      for (const chain of chainList) {
        const stepNames = chain.steps.map((s) => s.name).join(" -> ") || "(empty)";
        console.log(chain.name + ": " + stepNames);
      }
      return;
    }
    case "run": {
      const name = args[1];
      if (!name) { console.log("Usage: autoloops chain run <name> [project-dir] [prompt...]"); return; }
      const projectDir = args[2] ?? resolveRuntimeProjectDir();
      const prompt = args.slice(3).join(" ") || null;
      const chainsData = chains.load(projectDir);
      const chainSpec = chains.resolveChain(chainsData, name);
      if (!chainSpec) {
        console.log("chain `" + name + "` not found in chains.toml");
        return;
      }
      chains.runChain(chainSpec, projectDir, selfCommand(argv), { prompt: normalizePrompt(prompt) });
      return;
    }
    default:
      console.log("Usage:");
      console.log("  autoloops chain list [project-dir]");
      console.log("  autoloops chain run <name> [project-dir] [prompt...]");
  }
}

function handleListPresets(): void {
  for (const preset of chains.listKnownPresets()) {
    console.log(preset);
  }
}

function handleInspect(args: string[]): void {
  const spec = parseInspectArgs(args);
  if (!spec.artifact) return;

  const { artifact, selector, projectDir, format } = spec;

  switch (artifact) {
    case "scratchpad":
      harness.renderScratchpadFormat(projectDir, format);
      return;
    case "memory":
      if (format === "json") console.log(memory.rawProject(projectDir));
      else console.log(memory.listProject(projectDir));
      return;
    case "journal":
      harness.renderJournal(projectDir);
      return;
    case "coordination":
      harness.renderCoordinationFormat(projectDir, format);
      return;
    case "metrics":
      if (selector) harness.renderMetricsForRun(projectDir, selector, format);
      else harness.renderMetrics(projectDir, format);
      return;
    case "chain":
      console.log(chains.renderChainState(projectDir));
      return;
    case "prompt":
      if (!selector) { console.log("inspect prompt requires an iteration selector"); return; }
      harness.renderPromptFormat(projectDir, selector, format);
      return;
    case "output":
      if (!selector) { console.log("inspect output requires an iteration selector"); return; }
      harness.renderOutput(projectDir, selector);
      return;
    default:
      console.log("unsupported inspect target `" + artifact + "` with format `" + format + "`");
      console.log("");
      console.log("Valid targets and formats:");
      console.log("  scratchpad   md, terminal");
      console.log("  memory       md, terminal, json");
      console.log("  journal      json");
      console.log("  coordination md, terminal");
      console.log("  metrics      md, terminal, csv, json");
      console.log("  chain        md, terminal");
      console.log("  prompt       md, terminal        (requires iteration selector)");
      console.log("  output       text                (requires iteration selector)");
  }
}

interface InspectSpec {
  artifact: string;
  selector: string;
  projectDir: string;
  format: string;
}

function parseInspectArgs(args: string[]): InspectSpec {
  const artifact = args[0] ?? "";
  let format = "";
  const positionals: string[] = [];

  let i = 1;
  while (i < args.length) {
    if (args[i] === "--format") {
      format = args[i + 1] ?? "";
      i += 2;
    } else {
      positionals.push(args[i]);
      i++;
    }
  }

  if (!format) {
    format = inspectDefaultFormat(artifact);
  }

  const needsSelector = artifact === "prompt" || artifact === "output";
  const selector = needsSelector ? (positionals[0] ?? "") : (artifact === "metrics" ? (positionals[0] ?? "") : "");
  const projectDir = needsSelector
    ? (positionals[1] ?? resolveRuntimeProjectDir())
    : (artifact === "metrics" && positionals.length > 1
        ? positionals[1]
        : (positionals[0] ?? resolveRuntimeProjectDir()));

  return { artifact, selector, projectDir, format };
}

function inspectDefaultFormat(artifact: string): string {
  if (artifact === "output") return "text";
  if (artifact === "journal") return "json";
  return "terminal";
}

interface RunOptions {
  projectDir: string;
  prompt: string | null;
  backendOverride: Record<string, unknown>;
  logLevel: string | null;
  chain: string | null;
  presetExplicit: boolean;
  positionals: string[];
  usageError: boolean;
  workDir?: string;
}

function parseRunArgs(args: string[], bundleRoot: string): RunOptions {
  const options: RunOptions = {
    projectDir: ".",
    prompt: null,
    backendOverride: {},
    logLevel: null,
    chain: null,
    presetExplicit: false,
    positionals: [],
    usageError: false,
  };

  let i = 0;
  while (i < args.length) {
    const token = args[i];

    if (token === "run") { i++; continue; }
    if (token === "--verbose" || token === "-v") { options.logLevel = "debug"; i++; continue; }
    if (token === "-b" || token === "--backend") {
      const backend = args[i + 1];
      if (!backend) { console.log("missing backend after " + token); options.usageError = true; return options; }
      options.backendOverride = backendOverrideSpec(backend);
      i += 2; continue;
    }
    if (token === "-p" || token === "--preset") {
      const preset = args[i + 1];
      if (!preset) { console.log("missing preset after " + token); options.usageError = true; return options; }
      const resolved = config.resolveProjectDir(preset, bundleRoot);
      if (!resolved) { console.log("preset `" + preset + "` not found"); options.usageError = true; return options; }
      options.projectDir = resolved;
      options.presetExplicit = true;
      i += 2; continue;
    }
    if (token === "--chain") {
      const chainVal = args[i + 1];
      if (!chainVal) { console.log("missing chain after --chain"); options.usageError = true; return options; }
      options.chain = chainVal;
      i += 2; continue;
    }
    if (token === "-i" || token === "--iterations") {
      console.log("unsupported flag `" + token + "`; set event_loop.max_iterations in the preset config");
      options.usageError = true; return options;
    }

    options.positionals.push(token);
    i++;
  }

  return finalizeRunArgs(options, bundleRoot);
}

function finalizeRunArgs(options: RunOptions, bundleRoot: string): RunOptions {
  if (options.usageError) return options;
  const positionals = options.positionals;

  if (options.presetExplicit) {
    options.prompt = positionals.join(" ") || null;
    return options;
  }

  if (positionals.length === 0) {
    if (options.chain) {
      options.projectDir = defaultChainProjectDir(bundleRoot);
      return options;
    }
    missingPresetError();
    options.usageError = true;
    return options;
  }

  const first = positionals[0];
  const rest = positionals.slice(1);

  if (options.chain) {
    if (looksLikeProjectDir(first)) {
      options.projectDir = first;
      options.prompt = rest.join(" ") || null;
    } else {
      options.projectDir = defaultChainProjectDir(bundleRoot);
      options.prompt = positionals.join(" ") || null;
    }
    return options;
  }

  if (looksLikeProjectDir(first)) {
    options.projectDir = first;
    options.prompt = rest.join(" ") || null;
    return options;
  }

  const bundledPreset = config.resolveProjectDir(first, bundleRoot);
  if (!bundledPreset) {
    unknownPresetError(first);
    options.usageError = true;
    return options;
  }
  options.projectDir = bundledPreset;
  options.prompt = rest.join(" ") || null;
  return options;
}

function runInlineChain(
  chainCsv: string,
  projectDir: string,
  selfCmd: string,
  options: RunOptions,
): void {
  const chainSpec = chains.parseInlineChain(chainCsv, projectDir);
  const stepNames = chainSpec.steps.map((s) => s.name);
  const validation = chains.validatePresetVocabulary(stepNames, projectDir);
  if (!validation.ok) {
    console.log("error: invalid inline chain");
    console.log("");
    console.log(validation.reason ?? "");
    console.log("");
    console.log("Known presets: " + joinCsv(chains.listKnownPresets()));
    return;
  }
  chains.runChain(chainSpec, projectDir, selfCmd, { prompt: normalizePrompt(options.prompt) });
}

function resolveRuntimeProjectDir(): string {
  return process.env["MINILOOPS_PROJECT_DIR"] || ".";
}

function normalizePrompt(prompt: string | null): string | null {
  if (prompt === null || prompt === "") return null;
  return prompt;
}

function backendOverrideSpec(backend: string): Record<string, unknown> {
  if (backend === "pi") {
    return { kind: "pi", command: "pi", args: [], prompt_mode: "arg" };
  }
  if (claudeBackend(backend)) {
    return { kind: "command", command: backend, args: ["-p", "--dangerously-skip-permissions"], prompt_mode: "arg" };
  }
  return { kind: "command", command: backend, args: [], prompt_mode: "arg" };
}

function claudeBackend(backend: string): boolean {
  return backend === "claude" || backend.endsWith("/claude");
}

function looksLikeProjectDir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return config.projectHasConfig(path);
}

function defaultChainProjectDir(bundleRoot: string): string {
  if (looksLikeProjectDir(".")) return ".";
  return bundleRoot;
}

function runtimeArgv(argv: string[]): string[] {
  // argv[0] is node, argv[1] is script, rest is user args
  const userArgs = argv.slice(2);
  if (userArgs.length === 0) return [];

  // If first arg is a CLI command, use as-is
  if (isCliCommand(userArgs[0])) return userArgs;

  // For "tonic run <project>" form, skip the "run <project>"
  if (userArgs[0] === "run" && userArgs.length >= 2) {
    return userArgs;
  }

  return userArgs;
}

function isCliCommand(value: string): boolean {
  return ["run", "emit", "inspect", "memory", "list", "chain", "pi-adapter", "branch-run", "--help", "-h"].includes(value);
}

function selfCommand(argv: string[]): string {
  // Return a command that re-invokes this program
  return "'" + resolve(argv[1] ?? "autoloops-ts") + "'";
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
