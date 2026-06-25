import { join } from "node:path";
import {
  runAcpIteration,
  runClaudeSdkIteration,
  runPiIteration,
} from "@mobrienv/autoloop-backends";
import type { AcpClientOptions } from "@mobrienv/autoloop-backends/acp-client";
import {
  initAcpSession,
  terminateAcpSession,
} from "@mobrienv/autoloop-backends/acp-client";
import {
  getClaudeSdkUsage,
  initClaudeSdkSession,
  terminateClaudeSdkSession,
} from "@mobrienv/autoloop-backends/claude-sdk-client";
import {
  getPiSessionStats,
  initPiSession,
  resetPiSession,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";
import { jsonField, jsonFieldRaw, listText } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
  extractField,
  extractIteration,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { awaitHumanResponse } from "./ask.js";
import { log } from "./display.js";
import {
  appendInvalidEvent,
  invalidEvent,
  parallelTriggerTopic,
  systemTopic,
} from "./emit.js";
import { loopStartMs } from "./guards.js";
import { buildHookEnv, captureGitSha, runHook } from "./hooks.js";
import {
  appendBackendFinish,
  appendBackendStart,
  appendIterationFinish,
  appendIterationStart,
  buildBackendCommand,
  runProcess,
} from "./parallel.js";
import type { IterationContext } from "./prompt.js";
import { buildIterationContext } from "./prompt.js";
import { registryProgress } from "./registry-bridge.js";
import {
  completeLoop,
  stopBackendFailed,
  stopBackendTimeout,
  stopMaxRuntime,
} from "./stop.js";
import type { LoopContext, RunSummary } from "./types.js";
import {
  continueAfterParallelJoin,
  executeParallelWave,
  stopAfterParallelWave,
} from "./wave.js";

export async function runIteration(
  loop: LoopContext,
  iteration: number,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
): Promise<RunSummary> {
  let iter = buildIterationContext(loop, iteration);

  // Clamp the iteration timeout to the remaining loop wall-clock budget so a
  // long iteration never overshoots event_loop.max_runtime. Applied before
  // appendBackendStart so the journaled timeout_ms is the effective value.
  const maxRuntimeMs = loop.limits.maxRuntimeMs ?? 0;
  let clampedByLoopBudget = false;
  let loopStartedMs: number | null = null;
  if (maxRuntimeMs > 0) {
    loopStartedMs = loopStartMs(
      readRunLines(loop.paths.journalFile, loop.runtime.runId),
    );
    if (loopStartedMs !== null) {
      const remainingMs = Math.max(
        1,
        maxRuntimeMs - (Date.now() - loopStartedMs),
      );
      if (remainingMs < iter.backend.timeoutMs) {
        iter = {
          ...iter,
          backend: { ...iter.backend, timeoutMs: remainingMs },
        };
        clampedByLoopBudget = true;
      }
    }
  }

  loop.onEvent?.({
    type: "iteration.banner",
    iteration: iter.iteration,
    maxIterations: loop.limits.maxIterations,
    allowedRoles: iter.allowedRoles,
    recentEvent: iter.recentEvent,
    allowedEvents: iter.allowedEvents,
    lastRejected: iter.lastRejected,
  });
  appendIterationStart(loop, iter);
  log(loop, "debug", `iteration ${iteration} start`);
  appendBackendStart(loop, iter);
  log(loop, "debug", `backend start command=${iter.backend.command}`);

  const startEpoch = Math.floor(Date.now() / 1000);
  const gitShaBefore = captureGitSha(loop.paths.workDir);
  runHook(
    loop,
    "pre_iteration",
    loop.hooks.preIteration,
    buildHookEnv(loop, { iteration, gitShaBefore }),
    String(iteration),
  );

  // Fresh ACP session per iteration — ensures each role (researcher, critic,
  // etc.) starts with a clean context window for truly independent review.
  if (iter.backend.kind === "acp") {
    if (loop.acpSession.current) {
      try {
        await terminateAcpSession(loop.acpSession.current);
      } catch {
        /* best-effort */
      }
      loop.acpSession.current = undefined;
    }
    const acpOpts: AcpClientOptions = {
      provider: iter.backend.provider,
      command: iter.backend.command,
      args: iter.backend.args,
      cwd: loop.paths.workDir,
      trustAllTools: iter.backend.trustAllTools,
      agentName: iter.backend.agent || undefined,
      modelId: iter.backend.model || undefined,
      verbose: loop.runtime.logLevel === "debug",
    };
    loop.acpSession.current = await initAcpSession(acpOpts);
    log(
      loop,
      "debug",
      `new ACP session for iteration ${iteration} provider="${iter.backend.provider || "generic"}" agent="${acpOpts.agentName ?? "default"}"`,
    );
  }

  // Pi reuses one live RPC process across iterations; each iteration starts a
  // fresh conversation (`new_session`) so roles get a clean context window.
  if (iter.backend.kind === "pi") {
    await ensurePiSession(loop, iter, iteration);
  }

  // Fresh Claude Agent SDK session per iteration — one query is one
  // conversation, so a new query gives each role a clean context window
  // while keeping the streaming-input channel for live interrupt/steer.
  if (iter.backend.kind === "claude-sdk") {
    if (loop.claudeSdkSession.current) {
      try {
        await terminateClaudeSdkSession(loop.claudeSdkSession.current);
      } catch {
        /* best-effort */
      }
      loop.claudeSdkSession.current = undefined;
    }
    loop.claudeSdkSession.current = await initClaudeSdkSession({
      command:
        iter.backend.command && iter.backend.command !== "claude"
          ? iter.backend.command
          : undefined,
      model: iter.backend.model || undefined,
      cwd: loop.paths.workDir,
      trustAllTools: iter.backend.trustAllTools,
      verbose: loop.runtime.logLevel === "debug",
    });
    log(
      loop,
      "debug",
      `new claude-sdk session for iteration ${iteration} model="${iter.backend.model || "default"}"`,
    );
  }

  const { output, exitCode, timedOut } = await runBackendIteration(loop, iter);
  const elapsedS = Math.floor(Date.now() / 1000) - startEpoch;

  appendBackendFinish(loop, iter, output, exitCode, timedOut);
  appendIterationFinish(loop, iter, output, exitCode, timedOut, elapsedS);
  const gitShaAfter = captureGitSha(loop.paths.workDir);
  runHook(
    loop,
    "post_iteration",
    loop.hooks.postIteration,
    buildHookEnv(loop, { iteration, gitShaBefore, gitShaAfter }),
    String(iteration),
  );
  registryProgress(loop, iteration);
  log(loop, "debug", `iteration ${iteration} finish exit_code=${exitCode}`);
  loop.onEvent?.({
    type: "iteration.footer",
    iteration: iter.iteration,
    elapsedS,
  });
  loop.onEvent?.({ type: "backend.output", output });

  if (timedOut && clampedByLoopBudget && loopStartedMs !== null) {
    // The loop budget, not the per-iteration limit, was the binding
    // constraint on the timeout that fired — journal max_runtime.
    return stopMaxRuntime(
      loop,
      iteration,
      Date.now() - loopStartedMs,
      maxRuntimeMs,
      output,
    );
  }
  if (timedOut) return stopBackendTimeout(loop, iteration, output);
  if (exitCode !== 0) return stopBackendFailed(loop, iteration, output);
  return finishIteration(loop, iter, output, iterate);
}

async function runBackendIteration(
  loop: LoopContext,
  iter: IterationContext,
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  if (iter.backend.kind === "acp" && loop.acpSession.current) {
    return runAcpIteration(
      loop.acpSession.current,
      iter.prompt,
      iter.backend.timeoutMs,
    );
  }
  if (iter.backend.kind === "pi" && loop.piSession.current) {
    const result = await runPiIteration(
      loop.piSession.current,
      iter.prompt,
      iter.backend.timeoutMs,
      join(loop.paths.stateDir, `pi-stream.${iter.iteration}.jsonl`),
    );
    await recordPiUsage(loop, iter);
    return result;
  }
  if (iter.backend.kind === "claude-sdk" && loop.claudeSdkSession.current) {
    const result = await runClaudeSdkIteration(
      loop.claudeSdkSession.current,
      iter.prompt,
      iter.backend.timeoutMs,
      join(loop.paths.stateDir, `claude-stream.${iter.iteration}.jsonl`),
    );
    recordClaudeSdkUsage(loop, iter);
    return result;
  }
  return runProcess(
    buildBackendCommand(loop, iter),
    iter.backend.timeoutMs,
    iter.backend.kind,
  );
}

/**
 * Journal per-iteration token/cost totals from pi's get_session_stats.
 * Best-effort: telemetry never fails or stalls the iteration.
 */
async function recordPiUsage(
  loop: LoopContext,
  iter: IterationContext,
): Promise<void> {
  const session = loop.piSession.current;
  if (!session) return;
  const stats = await getPiSessionStats(session);
  if (!stats) return;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "backend.usage",
    jsonFieldRaw("input_tokens", String(stats.inputTokens)) +
      ", " +
      jsonFieldRaw("output_tokens", String(stats.outputTokens)) +
      ", " +
      jsonFieldRaw("cache_read_tokens", String(stats.cacheReadTokens)) +
      ", " +
      jsonFieldRaw("cache_write_tokens", String(stats.cacheWriteTokens)) +
      ", " +
      jsonFieldRaw("total_tokens", String(stats.totalTokens)) +
      ", " +
      jsonFieldRaw("cost_usd", String(stats.costUsd)) +
      (stats.contextPercent === undefined
        ? ""
        : `, ${jsonFieldRaw("context_percent", String(stats.contextPercent))}`),
  );
}

/**
 * Journal per-iteration token/cost totals from the claude-sdk result message.
 * Same event shape as the pi backend so cost-budget guards and usage
 * reporting work unchanged. Best-effort: telemetry never fails the iteration.
 */
function recordClaudeSdkUsage(loop: LoopContext, iter: IterationContext): void {
  const session = loop.claudeSdkSession.current;
  if (!session) return;
  const stats = getClaudeSdkUsage(session);
  if (!stats) return;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "backend.usage",
    jsonFieldRaw("input_tokens", String(stats.inputTokens)) +
      ", " +
      jsonFieldRaw("output_tokens", String(stats.outputTokens)) +
      ", " +
      jsonFieldRaw("cache_read_tokens", String(stats.cacheReadTokens)) +
      ", " +
      jsonFieldRaw("cache_write_tokens", String(stats.cacheWriteTokens)) +
      ", " +
      jsonFieldRaw("total_tokens", String(stats.totalTokens)) +
      ", " +
      jsonFieldRaw("cost_usd", String(stats.costUsd)),
  );
}

/**
 * Make sure a live pi RPC session with a fresh conversation is available.
 * Prefers a `new_session` reset on the running process; respawns when the
 * process is gone or refuses the reset.
 */
async function ensurePiSession(
  loop: LoopContext,
  iter: IterationContext,
  iteration: number,
): Promise<void> {
  const existing = loop.piSession.current;
  if (existing) {
    try {
      await resetPiSession(existing);
      log(loop, "debug", `pi session reset for iteration ${iteration}`);
      return;
    } catch {
      loop.piSession.current = undefined;
      try {
        await terminatePiSession(existing);
      } catch {
        /* best-effort */
      }
    }
  }
  loop.piSession.current = await initPiSession({
    command: iter.backend.command,
    args: iter.backend.args,
    cwd: loop.paths.workDir,
    modelId: iter.backend.model || undefined,
    verbose: loop.runtime.logLevel === "debug",
  });
  log(
    loop,
    "debug",
    `new pi RPC session for iteration ${iteration} model="${iter.backend.model || "default"}"`,
  );
}

export async function finishIteration(
  loop: LoopContext,
  iter: IterationContext,
  output: string,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
): Promise<RunSummary> {
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const allTopics = runLines.map(extractTopic).filter((t) => t !== "");
  const turnLines = runLines.filter(
    (l) => extractIteration(l) === String(iter.iteration),
  );
  const emitted = latestAgentEventRecord(turnLines);
  const hadInvalidEvents = turnLines.some(
    (l) => extractTopic(l) === "event.invalid",
  );

  const progress = (emittedTopic: string, outcome: string) =>
    loop.onEvent?.({
      type: "progress",
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      recentEvent: iter.recentEvent,
      allowedRoles: iter.allowedRoles,
      emittedTopic,
      outcome,
    });

  // Human-in-the-loop: a `human.ask` event pauses the loop until an operator
  // responds (or the timeout elapses); the answer is injected into the next
  // iteration as guidance. Handled before routing so the ask topic itself is
  // never treated as a routing/invalid event.
  if (loop.ask?.enabled && emitted.topic === loop.ask.event) {
    return finishAskIteration(loop, iter, emitted.payload, iterate, progress);
  }

  if (
    invalidEvent(
      emitted.topic,
      iter.allowedEvents,
      loop.parallel.enabled,
      loop.completion.event,
    )
  ) {
    return rejectInvalidAndContinue(
      loop,
      iter,
      emitted.topic,
      iterate,
      progress,
    );
  }

  if (parallelTriggerTopic(emitted.topic)) {
    return finishParallelIteration(
      loop,
      iter,
      emitted.topic,
      emitted.payload,
      iterate,
      progress,
    );
  }

  const resolved = resolveOutcome({
    emittedTopic: emitted.topic,
    allTopics,
    hadInvalidEvents,
    output,
    completionEvent: loop.completion.event,
    requiredEvents: loop.completion.requiredEvents,
    completionPromise: loop.completion.promise,
  });

  progress(emitted.topic, resolved.outcome);

  if (resolved.action === "complete_event")
    return completeLoop(loop, iter.iteration, "completion_event");
  if (resolved.action === "complete_promise")
    return completeLoop(loop, iter.iteration, "completion_promise");
  return iterate(loop, iter.iteration + 1);
}

/**
 * Block the loop on a `human.ask` until an operator responds (via the `respond`
 * control verb) or the timeout elapses, then continue. The answer is injected
 * into the next iteration's prompt via the existing operator-guidance path.
 */
async function finishAskIteration(
  loop: LoopContext,
  iter: IterationContext,
  question: string,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
  progress: (emittedTopic: string, outcome: string) => void,
): Promise<RunSummary> {
  const runId = loop.runtime.runId;
  const iteration = String(iter.iteration);
  const questionId = `ask_${runId}_${iter.iteration}`;

  appendEvent(
    loop.paths.journalFile,
    runId,
    iteration,
    "ask.pending",
    `${jsonField("question_id", questionId)}, ${jsonField("question", question)}`,
  );
  loop.onEvent?.({
    type: "ask.pending",
    runId,
    iteration: iter.iteration,
    questionId,
    question,
  });
  progress(loop.ask.event, "ask:waiting");

  const answer = await awaitHumanResponse({
    stateDir: loop.paths.stateDir,
    runId,
    questionId,
    timeoutMs: loop.ask.timeoutMs,
    pollMs: loop.ask.pollMs,
    signal: loop.signal,
  });

  if (answer === null) {
    if (loop.signal?.aborted) {
      return { iterations: iter.iteration, stopReason: "interrupted", runId };
    }
    appendEvent(
      loop.paths.journalFile,
      runId,
      iteration,
      "ask.timeout",
      jsonField("question_id", questionId),
    );
    progress(loop.ask.event, "ask:timeout");
    return iterate(loop, iter.iteration + 1);
  }

  appendEvent(
    loop.paths.journalFile,
    runId,
    iteration,
    "ask.answered",
    `${jsonField("question_id", questionId)}, ${jsonField("answer", answer)}`,
  );
  // Inject the answer into the next prompt via the operator-guidance path.
  appendOperatorEvent(
    loop.paths.journalFile,
    runId,
    iteration,
    "operator.guidance",
    `Human response to "${question}": ${answer}`,
  );
  loop.onEvent?.({
    type: "ask.answered",
    runId,
    iteration: iter.iteration,
    questionId,
    answer,
  });
  progress(loop.ask.event, "ask:answered");
  return iterate(loop, iter.iteration + 1);
}

async function rejectInvalidAndContinue(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
  progress: (topic: string, outcome: string) => void,
): Promise<RunSummary> {
  appendInvalidEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    iter.recentEvent,
    emittedTopic,
    iter.allowedRoles,
    iter.allowedEvents,
  );
  log(
    loop,
    "info",
    `[reject] invalid event \`${emittedTopic}\`; recent event: \`${iter.recentEvent}\`; allowed next events: ${listText(iter.allowedEvents)}`,
  );
  progress(emittedTopic, "rejected:event.invalid");
  return iterate(loop, iter.iteration + 1);
}

async function finishParallelIteration(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  emittedPayload: string,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
  progress: (topic: string, outcome: string) => void,
): Promise<RunSummary> {
  const result = executeParallelWave(loop, iter, emittedTopic, emittedPayload);

  if (result.reason === "parallel_wave_complete") {
    progress(emittedTopic, "parallel:joined");
    return continueAfterParallelJoin(
      loop,
      iter,
      result.waveId,
      emittedTopic,
      result.elapsedMs,
      iterate,
    );
  }
  progress(emittedTopic, `parallel:stop:${result.reason}`);
  return stopAfterParallelWave(loop, iter, result.reason, result.waveId);
}

export function resolveOutcome(ctx: {
  emittedTopic: string;
  allTopics: string[];
  hadInvalidEvents: boolean;
  output: string;
  completionEvent: string;
  requiredEvents: string[];
  completionPromise: string;
}): { action: string; outcome: string } {
  if (
    completedViaEvent(ctx.allTopics, ctx.completionEvent, ctx.requiredEvents)
  ) {
    return { action: "complete_event", outcome: "complete:completion_event" };
  }
  if (shouldContinueFromAcceptedEvent(ctx.emittedTopic, ctx.completionEvent)) {
    return { action: "continue_routed", outcome: "continue:routed_event" };
  }
  if (
    !ctx.hadInvalidEvents &&
    completedViaPromise(ctx.output, ctx.completionPromise)
  ) {
    return {
      action: "complete_promise",
      outcome: "complete:completion_promise",
    };
  }
  return { action: "continue", outcome: "continue" };
}

function latestAgentEventRecord(lines: string[]): {
  topic: string;
  payload: string;
} {
  for (let i = lines.length - 1; i >= 0; i--) {
    const topic = extractTopic(lines[i]);
    if (!systemTopic(topic)) {
      return { topic, payload: extractField(lines[i], "payload") };
    }
  }
  return { topic: "", payload: "" };
}

function completedViaEvent(
  topics: string[],
  completionEvent: string,
  requiredEvents: string[],
): boolean {
  if (!topics.includes(completionEvent)) return false;
  return requiredEvents.every((e) => topics.includes(e));
}

function completedViaPromise(output: string, promise: string): boolean {
  if (!promise) return false;
  return output.includes(promise);
}

function shouldContinueFromAcceptedEvent(
  emittedTopic: string,
  completionEvent: string,
): boolean {
  if (!emittedTopic) return false;
  return emittedTopic !== completionEvent;
}
