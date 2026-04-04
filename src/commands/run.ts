import * as harness from "../harness/index.js";
import * as chains from "../chains.js";
import * as config from "../config.js";
import { joinCsv } from "../utils.js";
import { printRunUsage, missingPresetError, unknownPresetError } from "../usage.js";

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

export function dispatchRun(args: string[], argv: string[], bundleRoot: string, selfCmd: string): boolean {
  if (args[0] === "--help" || args[0] === "-h") {
    printRunUsage();
    return true;
  }
  const options = parseRunArgs(args, bundleRoot);
  if (options.usageError) return true;

  if (options.chain) {
    runInlineChain(options.chain, options.projectDir, selfCmd, options);
    return true;
  }

  harness.run(
    options.projectDir,
    normalizePrompt(options.prompt),
    selfCmd,
    options,
  );
  return true;
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
    if (!require("node:fs").statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return config.projectHasConfig(path);
}

function defaultChainProjectDir(bundleRoot: string): string {
  if (looksLikeProjectDir(".")) return ".";
  return bundleRoot;
}
