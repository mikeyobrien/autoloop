import { jsonFieldRaw } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import * as topology from "@mobrienv/autoloop-core/topology";
import { type EmitResult, emitForIteration } from "./emit.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext } from "./types.js";

export type { EmitResult };

/** An in-process worker the harness hands each iteration to instead of spawning a backend. */
export interface HostWorker {
  /** Journaled as the backend label, e.g. "host:pi". */
  readonly label: string;
  /** Replaces the shell emit instructions in the prompt, e.g. "Call the `autoloop_emit` tool with {topic, payload}." */
  readonly eventToolHint: string;
  /** One iteration. Harness never calls again before the previous promise settles. Must not throw for model errors. */
  runTurn(turn: HostTurn): Promise<HostTurnResult>;
}

export interface HostRole {
  readonly id: string;
  readonly prompt: string;
}

export interface HostTurn {
  readonly runId: string;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly preset: string;
  /** Suggested roles, full prompts. */
  readonly roles: readonly HostRole[];
  readonly recentEvent: string;
  readonly allowedEvents: readonly string[];
  /** Exactly the text journaled in iteration.start.prompt. */
  readonly prompt: string;
  /** Validates against this iteration's routing, gates, task gate; journals accepted or event.invalid. */
  emit(topic: string, payload: string): EmitResult;
  /** Aborts on run stop or per-iteration deadline. */
  readonly signal: AbortSignal;
}

export type HostTurnResult =
  | { status: "completed"; output: string; usage?: HostUsage }
  | { status: "error"; output: string; usage?: HostUsage }
  | { status: "interrupted"; output: string; usage?: HostUsage };

export interface HostUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface HostIterationResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  interrupted: boolean;
}

const EXIT_CODE: Record<HostTurnResult["status"], number> = {
  completed: 0,
  error: 1,
  interrupted: 130,
};

/** Full prompts of the routed roles, in routing order. */
export function activeRoles(
  topo: topology.Topology,
  allowedRoles: readonly string[],
): HostRole[] {
  return allowedRoles.flatMap((id) => {
    const role = topo.roles.find((r) => r.id === id);
    return role ? [{ id: role.id, prompt: role.prompt }] : [];
  });
}

/**
 * Host mode runs every iteration as one in-process turn, so anything that
 * would launch a second LLM worker or park the run on a human fails closed
 * before loop.start is journaled.
 */
export function assertHostCompatible(loop: LoopContext): void {
  const problems: string[] = [];
  if (loop.review.enabled) problems.push("metareview is enabled");
  if (loop.parallel.enabled) problems.push("parallel.enabled is true");
  if (loop.topology.stages.length > 0)
    problems.push("topology declares fan-out stages");
  for (const role of topology.rolesWithConcurrency(loop.topology)) {
    problems.push(`role \`${role.id}\` has concurrency ${role.concurrency}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `host worker cannot run preset \`${loop.launch.preset}\`: ${problems.join("; ")}`,
    );
  }
}

export async function runHostIteration(
  loop: LoopContext,
  iter: IterationContext,
): Promise<HostIterationResult> {
  const host = loop.host;
  if (!host) throw new Error("runHostIteration called without loop.host");

  const turnAbort = new AbortController();
  let deadlineHit = false;
  const onRunAbort = () => turnAbort.abort(loop.signal?.reason);
  if (loop.signal?.aborted) onRunAbort();
  loop.signal?.addEventListener("abort", onRunAbort);
  const timer =
    iter.backend.timeoutMs > 0
      ? setTimeout(() => {
          deadlineHit = true;
          turnAbort.abort(new Error("iteration deadline exceeded"));
        }, iter.backend.timeoutMs)
      : undefined;

  let result: HostTurnResult;
  try {
    result = await host.runTurn({
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      maxIterations: loop.limits.maxIterations,
      preset: loop.launch.preset,
      roles: activeRoles(loop.topology, iter.allowedRoles),
      recentEvent: iter.recentEvent,
      allowedEvents: [...iter.allowedEvents],
      prompt: iter.prompt,
      emit: (topic, payload) => emitForIteration(loop, iter, topic, payload),
      signal: turnAbort.signal,
    });
  } finally {
    clearTimeout(timer);
    loop.signal?.removeEventListener("abort", onRunAbort);
  }

  if (result.usage) appendHostUsage(loop, iter.iteration, result.usage);
  if (deadlineHit) {
    return {
      output: result.output,
      exitCode: 1,
      timedOut: true,
      interrupted: false,
    };
  }
  return {
    output: result.output,
    exitCode: EXIT_CODE[result.status],
    timedOut: false,
    interrupted: result.status === "interrupted",
  };
}

function appendHostUsage(
  loop: LoopContext,
  iteration: number,
  usage: HostUsage,
): void {
  const totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "backend.usage",
    [
      jsonFieldRaw("input_tokens", String(usage.inputTokens)),
      jsonFieldRaw("output_tokens", String(usage.outputTokens)),
      jsonFieldRaw("cache_read_tokens", String(usage.cacheReadTokens)),
      jsonFieldRaw("cache_write_tokens", String(usage.cacheWriteTokens)),
      jsonFieldRaw("total_tokens", String(totalTokens)),
      jsonFieldRaw("cost_usd", String(usage.costUsd)),
    ].join(", "),
  );
}
