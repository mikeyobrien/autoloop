import { existsSync, rmSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { joinCsv } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import * as topo from "@mobrienv/autoloop-core/topology";
import * as harness from "@mobrienv/autoloop-harness";
import { claudeBackend } from "@mobrienv/autoloop-harness/config-helpers";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import * as chains from "../chains.js";
import { cliPrintEvent } from "../cli/event-printer.js";
import type { EventSink } from "../cli/events-sink.js";
import { ndjsonEventSink, teeEvents } from "../cli/events-sink.js";
import { EXIT_ENV, fail } from "../cli/fail.js";
import {
  missingPresetError,
  printRunUsage,
  unknownPresetError,
} from "../usage.js";

interface RunOptions {
  projectDir: string;
  presetFile?: string;
  prompt: string | null;
  backendOverride: Record<string, unknown>;
  configOverride: Record<string, unknown>;
  logLevel: string | null;
  chain: string | null;
  presetExplicit: boolean;
  positionals: string[];
  usageError: boolean;
  usageErrorMessage?: string;
  workDir?: string;
  profiles: string[];
  noDefaultProfiles: boolean;
  worktree?: boolean;
  noWorktree?: boolean;
  mergeStrategy?: string;
  automerge?: boolean;
  keepWorktree?: boolean;
  eventsPath?: string;
  /** Route an objective-without-preset through the `autoarchitect` preset. */
  architect?: boolean;
  /** Architect intensity: bias generation toward exhaustive fan-out + verify. */
  ultra?: boolean;
  /** Advisory dollar target for the architect; also the hard `max_cost_usd` ceiling. */
  budgetUsd?: string;
  /** The original objective, preserved to run the generated preset with. */
  architectObjective?: string;
  /** Path the architect must write the generated preset to (CLI-controlled). */
  architectOutputPath?: string;
  /** Force every fan-out stage branch to relaunch rather than resume. */
  noResume?: boolean;
}

function usageFail(options: RunOptions, message: string): RunOptions {
  fail(message);
  options.usageError = true;
  options.usageErrorMessage = message;
  return options;
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
  if (options.usageError) {
    // Parsing stops at the first invalid token, so only an --events flag parsed
    // before the error can receive the machine-readable terminal records.
    if (options.eventsPath) {
      let usageErrorSink: EventSink | null = null;
      try {
        usageErrorSink = ndjsonEventSink(options.eventsPath);
        usageErrorSink.onEvent({
          type: "log",
          level: "error",
          message: options.usageErrorMessage ?? "usage error",
        });
        usageErrorSink.onEvent({
          type: "loop.finish",
          iterations: 0,
          stopReason: "error",
          runId: "",
          costUsd: 0,
        });
      } catch {
        // Best-effort only: the stderr diagnostic and usage exit code remain.
      } finally {
        usageErrorSink?.close();
      }
    }
    return true;
  }

  // Optional structured event stream: write every LoopEvent as NDJSON to
  // --events <path>, in addition to (not replacing) terminal rendering. Built
  // up front so it covers the chain/automerge paths too. A bad path fails fast
  // with a clean message rather than an unhandled exception.
  let eventSink: EventSink | null = null;
  if (options.eventsPath) {
    try {
      eventSink = ndjsonEventSink(options.eventsPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `error: cannot open --events file '${options.eventsPath}': ${msg}\n`,
      );
      process.exitCode = EXIT_ENV;
      return true;
    }
  }
  const onEvent = eventSink
    ? teeEvents(cliPrintEvent, eventSink.onEvent)
    : cliPrintEvent;

  try {
    if (options.chain) {
      await runInlineChain(
        options.chain,
        options.projectDir,
        selfCmd,
        options,
        onEvent,
      );
      return true;
    }

    // --automerge sugar: build inline chain [preset, automerge]
    if (options.automerge) {
      const presetName = basename(options.projectDir);
      const chainCsv = `${presetName},automerge`;
      const chainProjectDir = defaultChainProjectDir(bundleRoot);
      await runInlineChain(
        chainCsv,
        chainProjectDir,
        selfCmd,
        options,
        onEvent,
      );
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
          onEvent,
          ...chainableOptions(options),
        },
      );
    } finally {
      process.removeListener("SIGINT", onSig);
      process.removeListener("SIGTERM", onSig);
      // Preserve historical exit-code behavior: re-raise the signal so the
      // process exits with 128+signum rather than 0 on Ctrl-C. Close the sink
      // first since the re-raised signal terminates the process.
      if (caughtSignal) {
        eventSink?.close();
        process.kill(process.pid, caughtSignal);
      }
    }

    // Architect auto-chain: the architect run designed a single-file preset;
    // validate it, then run it with the original objective (the generated
    // workflow doing the actual work).
    if (options.architect && options.architectOutputPath) {
      await runGeneratedPreset(options, selfCmd, onEvent);
    }
    return true;
  } finally {
    eventSink?.close();
  }
}

/**
 * Second link of the architect chain: load + statically validate the preset the
 * architect produced, then run it with the original objective. Refuses to run a
 * preset that does not exist or that the validator flags — the dead-topology
 * guard the whole design rests on.
 */
async function runGeneratedPreset(
  options: RunOptions,
  selfCmd: string,
  onEvent: (e: LoopEvent) => void,
): Promise<void> {
  const file = options.architectOutputPath as string;
  if (!existsSync(file)) {
    process.stderr.write(
      `\narchitect: no generated preset at ${file}; nothing to run.\n`,
    );
    process.exitCode = EXIT_ENV;
    return;
  }
  const topology = topo.loadTopologyFromFile(file);
  const warnings = topo.validateTopology(topology, { singleFile: true });
  if (warnings.length > 0) {
    process.stderr.write(
      `\narchitect: generated preset ${file} failed validation; not running:\n` +
        warnings.map((w) => `  - ${w.message}`).join("\n") +
        "\n",
    );
    process.exitCode = EXIT_ENV;
    return;
  }
  process.stderr.write(`\narchitect: running generated preset ${file}\n\n`);
  await harness.run(
    dirname(file),
    normalizePrompt(options.architectObjective ?? null),
    selfCmd,
    {
      presetFile: file,
      workDir: options.workDir,
      backendOverride: options.backendOverride,
      logLevel: options.logLevel,
      onEvent,
    },
  );
}

export function parseRunArgs(args: string[], bundleRoot: string): RunOptions {
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
        return usageFail(options, `missing backend after ${token}`);
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
        return usageFail(options, `missing iteration count after ${token}`);
      }
      setConfigOverride(options, "event_loop.max_iterations", value);
      i += 2;
      continue;
    }
    if (token === "--architect" || token === "--dynamic") {
      options.architect = true;
      i++;
      continue;
    }
    if (token === "--ultra") {
      // --ultra implies the architect path at maximum intensity.
      options.architect = true;
      options.ultra = true;
      i++;
      continue;
    }
    if (token === "--budget") {
      const value = args[i + 1];
      if (!value || !isFiniteBudget(value)) {
        return usageFail(
          options,
          `invalid --budget (expected a dollar amount): ${value}`,
        );
      }
      options.budgetUsd = value;
      // Opt-in hard ceiling: the advisory target also caps spend via the guard.
      setConfigOverride(options, "event_loop.max_cost_usd", value);
      i += 2;
      continue;
    }
    if (token === "--set") {
      const assignment = args[i + 1];
      if (!assignment) {
        return usageFail(options, "missing key=value after --set");
      }
      const parsed = parseConfigAssignment(assignment);
      if (!parsed) {
        return usageFail(options, `invalid --set assignment: ${assignment}`);
      }
      setConfigOverride(options, parsed.key, parsed.value);
      i += 2;
      continue;
    }
    if (token === "-p" || token === "--preset") {
      const preset = args[i + 1];
      if (!preset) {
        return usageFail(options, `missing preset after ${token}`);
      }
      const source = config.resolvePresetSource(preset, bundleRoot);
      if (!source) {
        return usageFail(options, `preset \`${preset}\` not found`);
      }
      options.projectDir = source.projectDir;
      if (source.kind === "file") options.presetFile = source.file;
      options.presetExplicit = true;
      i += 2;
      continue;
    }
    if (token === "--preset-file") {
      const path = args[i + 1];
      if (!path) {
        return usageFail(options, `missing path after ${token}`);
      }
      if (!config.pathIsSingleFilePreset(path)) {
        return usageFail(
          options,
          `--preset-file expects a path to an existing .toml file: ${path}`,
        );
      }
      options.presetFile = resolve(path);
      options.projectDir = dirname(resolve(path));
      options.presetExplicit = true;
      i += 2;
      continue;
    }
    if (token === "--chain") {
      const chainVal = args[i + 1];
      if (!chainVal) {
        return usageFail(options, "missing chain after --chain");
      }
      options.chain = chainVal;
      i += 2;
      continue;
    }
    if (token === "--profile") {
      const profile = args[i + 1];
      if (!profile) {
        return usageFail(options, "missing profile spec after --profile");
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
        return usageFail(options, "missing strategy after --merge-strategy");
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
    if (token === "--no-resume") {
      options.noResume = true;
      i++;
      continue;
    }
    if (token === "--events") {
      const path = args[i + 1];
      if (!path) {
        return usageFail(options, "missing path after --events");
      }
      options.eventsPath = path;
      i += 2;
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

function isFiniteBudget(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * Compose the design brief handed to the `autoarchitect` preset: the objective,
 * the intensity and optional advisory budget the architect sizes against, and
 * the exact path it must write the generated single-file preset to (so the CLI
 * can find, validate, and run it afterward).
 */
export function architectBrief(
  objective: string,
  ultra: boolean,
  outputPath: string,
  budgetUsd?: string,
): string {
  const intensity = ultra ? "ultra (maximally exhaustive)" : "standard";
  const budget = budgetUsd
    ? ` Budget target: $${budgetUsd} (also the hard ceiling).`
    : " No budget ceiling set; size the workflow modestly.";
  return (
    `Design directive: intensity=${intensity}.${budget}\n` +
    `Generated preset path: write the single-file preset to EXACTLY ${outputPath}\n\n` +
    `Objective: ${objective}`
  );
}

function architectOutputPath(workDir: string | undefined): string {
  return resolve(workDir || ".", ".autoloop", "generated-preset.toml");
}

function finalizeArchitectRun(
  options: RunOptions,
  bundleRoot: string,
): RunOptions {
  const source = config.resolvePresetSource("autoarchitect", bundleRoot);
  if (!source) {
    return usageFail(options, "error: autoarchitect preset not found");
  }
  options.projectDir = source.projectDir;
  if (source.kind === "file") options.presetFile = source.file;
  const objective = options.positionals.join(" ");
  options.architectObjective = objective;
  options.architectOutputPath = architectOutputPath(options.workDir);
  // Remove any stale generated preset from a prior run so a design that aborts
  // or emits design.blocked cannot leave the auto-chain running an old file.
  rmSync(options.architectOutputPath, { force: true });
  options.prompt = objective
    ? architectBrief(
        objective,
        options.ultra ?? false,
        options.architectOutputPath,
        options.budgetUsd,
      )
    : null;
  return applyGlobalBackendOverride(options);
}

function finalizeRunArgs(options: RunOptions, bundleRoot: string): RunOptions {
  if (options.usageError) return options;
  const positionals = options.positionals;

  if (options.architect && !options.presetExplicit) {
    return finalizeArchitectRun(options, bundleRoot);
  }

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
    options.usageErrorMessage = "missing required preset argument";
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

  const source = config.resolvePresetSource(first, bundleRoot);
  if (!source) {
    unknownPresetError(first);
    options.usageError = true;
    options.usageErrorMessage = `preset \`${first}\` not found`;
    return options;
  }
  options.projectDir = source.projectDir;
  if (source.kind === "file") options.presetFile = source.file;
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

export type { RunOptions };

export async function runInlineChain(
  chainCsv: string,
  projectDir: string,
  selfCmd: string,
  options: RunOptions,
  onEvent?: (e: LoopEvent) => void,
): Promise<void> {
  const chainSpec = chains.parseInlineChain(chainCsv, projectDir);
  const stepNames = chainSpec.steps.map((s) => s.name);
  const validation = chains.validatePresetVocabulary(stepNames, projectDir);
  if (!validation.ok) {
    fail([
      "error: invalid inline chain",
      "",
      validation.reason ?? "",
      "",
      `Known presets: ${joinCsv(chains.listKnownPresets())}`,
    ]);
    return;
  }
  // Forward the structured event sink so --events also captures chain steps.
  // Each step spreads these options into harness.run (chains/run.ts), so onEvent
  // propagates to every step's loop.
  await chains.runChain(chainSpec, projectDir, selfCmd, {
    prompt: normalizePrompt(options.prompt),
    onEvent,
    ...chainableOptions(options),
  });
}

export function normalizePrompt(prompt: string | null): string | null {
  if (prompt === null || prompt === "") return null;
  return prompt;
}

export function backendOverrideSpec(backend: string): Record<string, unknown> {
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
  if (backend === "hermes" || backend.startsWith("hermes:")) {
    const profile = backend.startsWith("hermes:")
      ? backend.slice("hermes:".length)
      : "";
    const spec = acpBackendOverride("hermes", "hermes", ["acp"]);
    if (profile) spec["profile"] = profile;
    return spec;
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

export function chainableOptions(opts: RunOptions): Record<string, unknown> {
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
