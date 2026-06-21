import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { joinCsv } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import * as harness from "@mobrienv/autoloop-harness";
import { claudeBackend } from "@mobrienv/autoloop-harness/config-helpers";
import * as chains from "../chains.js";
import { cliPrintEvent } from "../cli/event-printer.js";
import {
  missingPresetError,
  printRunUsage,
  unknownPresetError,
} from "../usage.js";

interface RunOptions {
  projectDir: string;
  prompt: string | null;
  backendOverride: Record<string, unknown>;
  configOverride: Record<string, unknown>;
  logLevel: string | null;
  chain: string | null;
  presetExplicit: boolean;
  positionals: string[];
  usageError: boolean;
  workDir?: string;
  profiles: string[];
  noDefaultProfiles: boolean;
  worktree?: boolean;
  noWorktree?: boolean;
  mergeStrategy?: string;
  automerge?: boolean;
  keepWorktree?: boolean;
}

export async function dispatchRun(
  args: string[],
  _argv: string[],
  bundleRoot: string,
  selfCmd: string,
): Promise<boolean> {
  // `--help` anywhere among the args shows help instead of starting a loop —
  // `autoloop run autocode --help` must never burn iterations. A quoted
  // prompt that merely *contains* "--help" arrives as one larger arg and is
  // unaffected.
  if (args.some((a) => a === "--help" || a === "-h")) {
    printRunUsage();
    return true;
  }
  const options = parseRunArgs(args, bundleRoot);
  if (options.usageError) return true;

  if (options.chain) {
    await runInlineChain(options.chain, options.projectDir, selfCmd, options);
    return true;
  }

  // --automerge sugar: build inline chain [preset, automerge]
  if (options.automerge) {
    const presetName = basename(options.projectDir);
    const chainCsv = `${presetName},automerge`;
    const chainProjectDir = defaultChainProjectDir(bundleRoot);
    await runInlineChain(chainCsv, chainProjectDir, selfCmd, options);
    return true;
  }

  // Install SIGINT/SIGTERM handlers that abort the harness via AbortSignal.
  // Previously the harness installed process.on handlers itself; the CLI
  // now owns that so the harness is embed-able from SDK consumers.
  const abort = new AbortController();
  let caughtSignal: NodeJS.Signals | null = null;
  const onSig = (sig: NodeJS.Signals) => {
    if (caughtSignal) return;
    caughtSignal = sig;
    abort.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    await harness.run(
      options.projectDir,
      normalizePrompt(options.prompt),
      selfCmd,
      {
        ...options,
        profiles: options.profiles.length > 0 ? options.profiles : undefined,
        noDefaultProfiles: options.noDefaultProfiles || undefined,
        signal: abort.signal,
        onEvent: cliPrintEvent,
        ...chainableOptions(options),
      },
    );
  } finally {
    process.removeListener("SIGINT", onSig);
    process.removeListener("SIGTERM", onSig);
    // Preserve historical exit-code behavior: re-raise the signal so the
    // process exits with 128+signum rather than 0 on Ctrl-C.
    if (caughtSignal) process.kill(process.pid, caughtSignal);
  }
  return true;
}

function parseRunArgs(args: string[], bundleRoot: string): RunOptions {
  const options: RunOptions = {
    projectDir: ".",
    prompt: null,
    backendOverride: {},
    configOverride: {},
    logLevel: null,
    chain: null,
    presetExplicit: false,
    positionals: [],
    usageError: false,
    profiles: [],
    noDefaultProfiles: false,
  };

  let i = 0;
  while (i < args.length) {
    const token = args[i];

    if (token === "run") {
      i++;
      continue;
    }
    if (token === "--verbose" || token === "-v") {
      options.logLevel = "debug";
      i++;
      continue;
    }
    if (token === "-b" || token === "--backend") {
      const backend = args[i + 1];
      if (!backend) {
        console.log(`missing backend after ${token}`);
        options.usageError = true;
        return options;
      }
      options.backendOverride = backendOverrideSpec(backend);
      i += 2;
      continue;
    }
    if (
      token === "--max-iterations" ||
      token === "--iterations" ||
      token === "-i"
    ) {
      const value = args[i + 1];
      if (!value) {
        console.log(`missing iteration count after ${token}`);
        options.usageError = true;
        return options;
      }
      setConfigOverride(options, "event_loop.max_iterations", value);
      i += 2;
      continue;
    }
    if (token === "--set") {
      const assignment = args[i + 1];
      if (!assignment) {
        console.log("missing key=value after --set");
        options.usageError = true;
        return options;
      }
      const parsed = parseConfigAssignment(assignment);
      if (!parsed) {
        console.log(`invalid --set assignment: ${assignment}`);
        options.usageError = true;
        return options;
      }
      setConfigOverride(options, parsed.key, parsed.value);
      i += 2;
      continue;
    }
    if (token === "-p" || token === "--preset") {
      const preset = args[i + 1];
      if (!preset) {
        console.log(`missing preset after ${token}`);
        options.usageError = true;
        return options;
      }
      const resolved = config.resolveProjectDir(preset, bundleRoot);
      if (!resolved) {
        console.log(`preset \`${preset}\` not found`);
        options.usageError = true;
        return options;
      }
      options.projectDir = resolved;
      options.presetExplicit = true;
      i += 2;
      continue;
    }
    if (token === "--chain") {
      const chainVal = args[i + 1];
      if (!chainVal) {
        console.log("missing chain after --chain");
        options.usageError = true;
        return options;
      }
      options.chain = chainVal;
      i += 2;
      continue;
    }
    if (token === "--profile") {
      const profile = args[i + 1];
      if (!profile) {
        console.log("missing profile spec after --profile");
        options.usageError = true;
        return options;
      }
      options.profiles.push(profile);
      i += 2;
      continue;
    }
    if (token === "--no-default-profiles") {
      options.noDefaultProfiles = true;
      i++;
      continue;
    }
    if (token === "--worktree") {
      options.worktree = true;
      i++;
      continue;
    }
    if (token === "--no-worktree") {
      options.noWorktree = true;
      i++;
      continue;
    }
    if (token === "--merge-strategy") {
      const val = args[i + 1];
      if (!val) {
        console.log("missing strategy after --merge-strategy");
        options.usageError = true;
        return options;
      }
      options.mergeStrategy = val;
      i += 2;
      continue;
    }
    if (token === "--automerge") {
      options.automerge = true;
      i++;
      continue;
    }
    if (token === "--keep-worktree") {
      options.keepWorktree = true;
      i++;
      continue;
    }

    options.positionals.push(token);
    i++;
  }

  return finalizeRunArgs(options, bundleRoot);
}

function setConfigOverride(
  options: RunOptions,
  key: string,
  value: string,
): void {
  options.configOverride = config.put(options.configOverride, key, value);
}

function parseConfigAssignment(
  assignment: string,
): { key: string; value: string } | null {
  const eq = assignment.indexOf("=");
  if (eq <= 0) return null;
  const key = assignment.slice(0, eq).trim();
  const value = assignment.slice(eq + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

function finalizeRunArgs(options: RunOptions, bundleRoot: string): RunOptions {
  if (options.usageError) return options;
  const positionals = options.positionals;

  if (options.presetExplicit) {
    options.prompt = positionals.join(" ") || null;
    return applyGlobalBackendOverride(options);
  }

  if (positionals.length === 0) {
    if (options.chain) {
      options.projectDir = defaultChainProjectDir(bundleRoot);
      return applyGlobalBackendOverride(options);
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
    return applyGlobalBackendOverride(options);
  }

  if (looksLikeProjectDir(first)) {
    options.projectDir = first;
    options.prompt = rest.join(" ") || null;
    return applyGlobalBackendOverride(options);
  }

  const bundledPreset = config.resolveProjectDir(first, bundleRoot);
  if (!bundledPreset) {
    unknownPresetError(first);
    options.usageError = true;
    return options;
  }
  options.projectDir = bundledPreset;
  options.prompt = rest.join(" ") || null;
  return applyGlobalBackendOverride(options);
}

function applyGlobalBackendOverride(options: RunOptions): RunOptions {
  const cwdProjectDir = process.cwd();
  if (!config.projectHasConfig(cwdProjectDir)) return options;
  if (resolve(cwdProjectDir) === resolve(options.projectDir)) return options;

  const globalBackendOverride =
    config.backendOverrideFromProject(cwdProjectDir);
  if (Object.keys(globalBackendOverride).length === 0) return options;

  if (config.hasUserConfig()) {
    process.stderr.write(
      "warning: cwd-based backend override is deprecated; configure backend in " +
        config.userConfigPath() +
        " instead\n",
    );
  }

  return {
    ...options,
    backendOverride: { ...globalBackendOverride, ...options.backendOverride },
  };
}

async function runInlineChain(
  chainCsv: string,
  projectDir: string,
  selfCmd: string,
  options: RunOptions,
): Promise<void> {
  const chainSpec = chains.parseInlineChain(chainCsv, projectDir);
  const stepNames = chainSpec.steps.map((s) => s.name);
  const validation = chains.validatePresetVocabulary(stepNames, projectDir);
  if (!validation.ok) {
    console.log("error: invalid inline chain");
    console.log("");
    console.log(validation.reason ?? "");
    console.log("");
    console.log(`Known presets: ${joinCsv(chains.listKnownPresets())}`);
    return;
  }
  await chains.runChain(chainSpec, projectDir, selfCmd, {
    prompt: normalizePrompt(options.prompt),
    ...chainableOptions(options),
  });
}

function normalizePrompt(prompt: string | null): string | null {
  if (prompt === null || prompt === "") return null;
  return prompt;
}

function backendOverrideSpec(backend: string): Record<string, unknown> {
  if (backend === "pi") {
    return { kind: "pi", command: "pi", args: [], prompt_mode: "arg" };
  }
  if (backend === "kiro" || backend === "kiro-cli") {
    return acpBackendOverride("kiro", "kiro-cli", ["acp"]);
  }
  if (backend === "claude-agent-acp") {
    return acpBackendOverride("claude-agent-acp", "npx", [
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
  }
  if (backend.startsWith("acp:")) {
    const [, provider, ...commandParts] = backend.split(":");
    const command = commandParts.join(":");
    return acpBackendOverride(provider || "generic", command || "", []);
  }
  // Claude runs through the Agent SDK session backend by default — live
  // interrupt/steer + cost telemetry. `--set backend.kind=command` restores
  // the legacy `claude -p` shell path.
  if (backend === "claude-sdk" || claudeBackend(backend)) {
    return {
      kind: "claude-sdk",
      command: backend === "claude-sdk" ? "claude" : backend,
      args: [],
      prompt_mode: "arg",
    };
  }
  return { kind: "command", command: backend, args: [], prompt_mode: "arg" };
}

function acpBackendOverride(
  provider: string,
  command: string,
  args: string[],
): Record<string, unknown> {
  return {
    kind: "acp",
    provider,
    command,
    args,
    prompt_mode: "acp",
  };
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

function chainableOptions(opts: RunOptions): Record<string, unknown> {
  return {
    backendOverride: opts.backendOverride,
    configOverride: opts.configOverride,
    worktree: opts.worktree || undefined,
    noWorktree: opts.noWorktree || undefined,
    mergeStrategy: opts.mergeStrategy,
    automerge: opts.automerge || undefined,
    keepWorktree: opts.keepWorktree || undefined,
  };
}
