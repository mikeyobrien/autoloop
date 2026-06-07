// Run executor for the ACP console.
//
// Translates an ACP `run` (or `chain`) prompt into a harness loop, bridging the
// LoopEvent stream onto ACP session/update notifications via EventBridge. The
// turn resolves with an ACP stop reason ("end_turn" or "cancelled").
//
// Cancellation: the caller owns an AbortController and aborts it when the ACP
// client sends session/cancel. The harness listens to the signal for graceful
// teardown and the bridge marks the turn cancelled.

import { basename } from "node:path";
import * as harness from "@mobrienv/autoloop-harness";
import * as chains from "../chains.js";
import {
  chainableOptions,
  normalizePrompt,
  parseRunArgs,
  type RunOptions,
  runInlineChain,
} from "../commands/run.js";
import { EventBridge, type SessionUpdateSink } from "./event-bridge.js";

export interface RunExecContext {
  bundleRoot: string;
  selfCmd: string;
  /**
   * Project directory the loop should operate on (the session's cwd). Passed to
   * the harness as `workDir`; the preset directory is resolved separately from
   * the run arguments.
   */
  projectDir: string;
  /** Per-turn abort signal, aborted on session/cancel. */
  signal: AbortSignal;
  /** Sink for ACP session updates. */
  sink: SessionUpdateSink;
  /** Unique tool-call id for this run's grouped output. */
  toolCallId: string;
  /** Surface debug logs as agent thoughts. */
  verbose?: boolean;
}

export interface RunExecResult {
  stopReason: "end_turn" | "cancelled";
  summary: string;
  /** Set when arguments failed to parse; summary holds the usage text. */
  usageError?: boolean;
}

/**
 * Execute a `run`/`chain` verb. `verb` is the command name ("run" or "chain");
 * `args` are the tokens after it.
 */
export async function executeRun(
  verb: string,
  args: string[],
  ctx: RunExecContext,
): Promise<RunExecResult> {
  if (verb === "chain") {
    return executeChain(args, ctx);
  }

  const fullArgs = ["run", ...args];
  const options = parseRunArgs(fullArgs, ctx.bundleRoot);
  if (options.usageError) {
    return {
      stopReason: "end_turn",
      summary: "Invalid run arguments. See `/run` usage.",
      usageError: true,
    };
  }

  const pump = new EventPump(ctx.sink, ctx.toolCallId, ctx.verbose);
  ctx.signal.addEventListener("abort", () => pump.bridge.markCancelled(), {
    once: true,
  });

  if (options.chain) {
    await runInlineChain(options.chain, options.projectDir, ctx.selfCmd, {
      ...options,
      workDir: ctx.projectDir,
      signal: ctx.signal,
      onEvent: pump.onEvent,
    } as unknown as RunOptions);
    return finalize(pump);
  }

  if (options.automerge) {
    const presetName = basename(options.projectDir);
    const chainCsv = `${presetName},automerge`;
    await runChainCsv(chainCsv, options, ctx, pump.onEvent);
    return finalize(pump);
  }

  await harness.run(
    options.projectDir,
    normalizePrompt(options.prompt),
    ctx.selfCmd,
    {
      ...options,
      workDir: ctx.projectDir,
      profiles: options.profiles.length > 0 ? options.profiles : undefined,
      noDefaultProfiles: options.noDefaultProfiles || undefined,
      signal: ctx.signal,
      onEvent: pump.onEvent,
      ...chainableOptions(options),
    },
  );
  return finalize(pump);
}

async function executeChain(
  args: string[],
  ctx: RunExecContext,
): Promise<RunExecResult> {
  // `chain list` is informational; route it through a synchronous listing.
  const sub = args[0] ?? "";
  if (sub === "" || sub === "list" || sub === "--help" || sub === "-h") {
    const known = chains.listKnownPresets();
    return {
      stopReason: "end_turn",
      summary: `Usage: chain run <a,b,c> [objective]\nKnown presets: ${known.join(", ")}`,
    };
  }

  // `chain run <csv> [objective]` — execute as an inline chain with streaming.
  if (sub === "run") {
    const csv = args[1] ?? "";
    if (!csv) {
      return {
        stopReason: "end_turn",
        summary: "Usage: chain run <a,b,c> [objective]",
      };
    }
    const objective = args.slice(2).join(" ");
    const pump = new EventPump(ctx.sink, ctx.toolCallId, ctx.verbose);
    ctx.signal.addEventListener("abort", () => pump.bridge.markCancelled(), {
      once: true,
    });
    const chainSpec = chains.parseInlineChain(csv, ctx.projectDir);
    await chains.runChain(chainSpec, ctx.projectDir, ctx.selfCmd, {
      prompt: normalizePrompt(objective || null),
      workDir: ctx.projectDir,
      signal: ctx.signal,
      onEvent: pump.onEvent,
    });
    return finalize(pump);
  }

  return {
    stopReason: "end_turn",
    summary: `Unknown chain subcommand: ${sub}`,
  };
}

async function runChainCsv(
  chainCsv: string,
  options: RunOptions,
  ctx: RunExecContext,
  onEvent: harness.RunOptions["onEvent"],
): Promise<void> {
  const chainSpec = chains.parseInlineChain(chainCsv, options.projectDir);
  await chains.runChain(chainSpec, options.projectDir, ctx.selfCmd, {
    prompt: normalizePrompt(options.prompt),
    workDir: ctx.projectDir,
    signal: ctx.signal,
    onEvent,
    ...chainableOptions(options),
  });
}

/**
 * Adapts the synchronous LoopEventEmitter contract to the async EventBridge.
 * Bridge handlers await sink writes, so we serialize them through a promise
 * chain and expose `drain()` to flush before reading the final result.
 */
class EventPump {
  readonly bridge: EventBridge;
  private chain: Promise<void> = Promise.resolve();

  constructor(sink: SessionUpdateSink, toolCallId: string, verbose?: boolean) {
    this.bridge = new EventBridge(sink, toolCallId, { verbose });
  }

  readonly onEvent: harness.RunOptions["onEvent"] = (event) => {
    this.chain = this.chain
      .then(() => this.bridge.handle(event))
      .catch(() => {});
  };

  async drain(): Promise<void> {
    await this.chain;
  }
}

async function finalize(pump: EventPump): Promise<RunExecResult> {
  await pump.drain();
  const result = pump.bridge.result();
  return { stopReason: result.stopReason, summary: result.summary };
}
