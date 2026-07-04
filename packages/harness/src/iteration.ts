import { join } from "node:path";
import {
  classifyBackendError,
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
import { materializeOpenFrom } from "@mobrienv/autoloop-core/tasks";
import * as topology from "@mobrienv/autoloop-core/topology";
import { reinjectAcceptanceFailure, runAcceptanceGate } from "./acceptance.js";
import { awaitHumanResponse } from "./ask.js";
import {
  backoffDelayMs,
  circuitDecision,
  countTransientPauses,
} from "./circuit-breaker.js";
import { log } from "./display.js";
import {
  appendInvalidEvent,
  invalidEvent,
  parallelTriggerTopic,
  systemTopic,
} from "./emit.js";
import { loopStartMs } from "./guards.js";
import { buildHookEnv, captureGitSha, runHook } from "./hooks.js";
import { reinjectIntentFailure, runIntentCriteria } from "./intent.js";
import {
  appendBackendFinish,
  appendBackendStart,
  appendIterationFinish,
  appendIterationStart,
  buildBackendCommand,
  runProcess,
} from "./parallel.js";
import {
  reinjectPostconditionFailure,
  runPostconditionGuards,
} from "./postconditions.js";
import { runProgressMetric } from "./progress.js";
import type { IterationContext } from "./prompt.js";
import { buildIterationContext } from "./prompt.js";
import {
  consumeHumanAck,
  enterProvisional,
  holdProvisional,
  releaseProvisional,
  resolveProvisional,
} from "./provisional.js";
import { registryProgress } from "./registry-bridge.js";
import {
  completeLoop,
  stopBackendErrorClass,
  stopBackendFailed,
  stopBackendTimeout,
  stopMaxRuntime,
} from "./stop.js";
import { reinjectTamperFailure, runTamperScreen } from "./tamper.js";
import type { LoopContext, RunSummary } from "./types.js";
import {
  continueAfterParallelJoin,
  executeDeclarativeWave,
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
      disallowedTools: iter.backend.disallowedTools,
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
  // Capture the preset-declared progress scalar each iteration (drift signal).
  runProgressMetric(loop, iteration);
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
  if (exitCode !== 0) {
    return handleBackendFailure(loop, iteration, output, iterate);
  }
  return finishIteration(loop, iter, output, iterate);
}

/**
 * Classify a non-zero backend exit. A typed transient/rate-limit/auth/quota
 * error is handled by the circuit breaker — retryable classes pause-and-retry
 * (rather than fast-failing into a laundered verdict or generic death) until
 * the breaker opens; non-retryable classes stop with a typed reason. Anything
 * unclassified is a plain backend failure.
 */
async function handleBackendFailure(
  loop: LoopContext,
  iteration: number,
  output: string,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
): Promise<RunSummary> {
  const errorClass = classifyBackendError(output);
  if (errorClass === "none") return stopBackendFailed(loop, iteration, output);

  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const pauses = countTransientPauses(runLines);
  const decision = circuitDecision(
    errorClass,
    pauses,
    loop.limits.transientMaxPauses ?? 3,
  );
  if (decision.action === "stop") {
    return stopBackendErrorClass(loop, iteration, decision.reason, output);
  }
  // Pause-and-retry with exponential backoff: a transient blip becomes a retry
  // instead of run-death. The Nth retry waits base*2^(N-1), capped.
  const attempt = pauses + 1;
  const pauseMs = backoffDelayMs(
    attempt,
    loop.limits.transientPauseMs ?? 5000,
    loop.limits.transientBackoffCapMs ?? 30000,
  );
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "backend.transient",
    jsonField("error_class", errorClass) +
      ", " +
      jsonField("pause_count", String(attempt)) +
      ", " +
      jsonFieldRaw("backoff_ms", String(pauseMs)) +
      ", " +
      jsonField("output_tail", output.slice(-500)),
  );
  log(
    loop,
    "warn",
    `transient backend error (${errorClass}); retry ${attempt}/${loop.limits.transientMaxPauses ?? 3} after ${pauseMs}ms backoff`,
  );
  if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  return iterate(loop, iteration + 1);
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

  // Declarative concurrency (ralph v3 style): if the just-emitted event
  // routes (via [handoff]) to a role that declares `concurrency > 0`, the
  // harness auto-launches N concurrent branches for that role — no agent
  // `.parallel` emit required. This takes precedence over ordinary routing
  // for that event; agent-triggered `.parallel` (handled above) is
  // unaffected and remains fully backward compatible. Synthetic wave/joined
  // topics (`wave.*`, `*.parallel.joined`) never re-enter this path since
  // `emitted.topic` is always an agent-emitted, non-system event here.
  if (loop.parallel.enabled) {
    const concurrentRoles = topology.concurrentRolesForEvent(
      loop.topology,
      emitted.topic,
    );
    if (concurrentRoles.length > 0) {
      // Execution is synchronous (one wave resolves per iteration); when an
      // event routes to more than one concurrency role, the first declared
      // role's wave runs this iteration — the routing event still applies
      // (via the resume topic) on subsequent iterations for any others.
      return finishDeclarativeIteration(
        loop,
        iter,
        emitted.topic,
        concurrentRoles[0],
        iterate,
        progress,
      );
    }
  }

  // Open-task gate for the completion-promise path. Mirror the event-path gate
  // in emit.ts (same store via loop.paths.tasksFile, soft tasks are advisory)
  // so a stdout promise can't bypass the requirement the emitted event honors.
  const hasBlockingTasks = materializeOpenFrom(loop.paths.tasksFile).some(
    (t) => t.soft !== true,
  );

  const resolved = resolveOutcome({
    emittedTopic: emitted.topic,
    allTopics,
    hadInvalidEvents,
    output,
    completionEvent: loop.completion.event,
    requiredEvents: loop.completion.requiredEvents,
    completionPromise: loop.completion.promise,
    hasBlockingTasks,
  });

  progress(emitted.topic, resolved.outcome);

  if (
    resolved.action === "complete_event" ||
    resolved.action === "complete_promise"
  ) {
    const reason =
      resolved.action === "complete_event"
        ? "completion_event"
        : "completion_promise";
    // Provisional-done hold: a self-asserted done-claim parks in
    // `awaiting_acceptance` before any irreversible action and is released only
    // when the deterministic gates pass (or an operator acknowledges).
    enterProvisional(loop, iter.iteration, reason);
    // Out-of-band acceptance gate: the harness runs deterministic verify
    // commands on the done-claim.
    const gate = runAcceptanceGate(loop, iter.iteration);
    // Required-absence guards: catch reward-hacks (leftover TODO, skipped
    // tests, secrets, dirty tree) the verify commands and LLM gates may miss.
    // Only run when the acceptance gate passed (the run is already held
    // otherwise).
    const guards = gate.passed
      ? runPostconditionGuards(loop, iter.iteration)
      : { ran: false, passed: false, violations: [] };
    // Anti-reward-hack screen: under bypassPermissions the maker can edit the
    // very tests that gate it, so a test-backed "done" is screened for test
    // tampering before release.
    const tamper = gate.passed
      ? runTamperScreen(loop, iter.iteration)
      : { ran: false, passed: false, violations: [] };
    // Intent-binding: the build must satisfy the stated acceptance criteria,
    // not just pass its tests.
    const intent = gate.passed
      ? runIntentCriteria(loop, iter.iteration)
      : { ran: false, passed: false, failures: [] };
    const humanAck = consumeHumanAck(loop);
    const state = resolveProvisional({
      acceptancePassed: gate.passed,
      postconditionsPassed: guards.passed && tamper.passed && intent.passed,
      humanAck,
    });
    if (state === "accepted") {
      releaseProvisional(loop, iter.iteration, humanAck);
      return completeLoop(loop, iter.iteration, reason);
    }
    // Held: re-inject the most specific failure and route back to rework.
    let cause = "acceptance";
    if (!gate.passed) {
      reinjectAcceptanceFailure(loop, iter.iteration, gate);
    } else if (!guards.passed) {
      reinjectPostconditionFailure(loop, iter.iteration, guards);
      cause = "postcondition";
    } else if (!tamper.passed) {
      reinjectTamperFailure(loop, iter.iteration, tamper);
      cause = "tamper";
    } else {
      reinjectIntentFailure(loop, iter.iteration, intent);
      cause = "intent";
    }
    holdProvisional(loop, iter.iteration, cause);
    progress(emitted.topic, "hold:awaiting_acceptance");
    return iterate(loop, iter.iteration + 1);
  }
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

/**
 * Declarative-wave counterpart of `finishParallelIteration`: the routing
 * event itself (not an agent `.parallel` emit) triggers N concurrent
 * branches for `role`, per its topology `concurrency` declaration. Join/stop
 * handling mirrors the agent-triggered path so downstream resume routing
 * (`continueAfterParallelJoin`/`stopAfterParallelWave`) behaves identically.
 */
async function finishDeclarativeIteration(
  loop: LoopContext,
  iter: IterationContext,
  routingEvent: string,
  role: topology.Role,
  iterate: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
  progress: (topic: string, outcome: string) => void,
): Promise<RunSummary> {
  const result = executeDeclarativeWave(loop, iter, role, routingEvent);
  const syntheticTopic = `${routingEvent}.parallel`;

  if (result.reason === "parallel_wave_complete") {
    progress(syntheticTopic, "parallel:joined");
    return continueAfterParallelJoin(
      loop,
      iter,
      result.waveId,
      syntheticTopic,
      result.elapsedMs,
      iterate,
    );
  }
  progress(syntheticTopic, `parallel:stop:${result.reason}`);
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
  hasBlockingTasks: boolean;
}): { action: string; outcome: string } {
  if (
    completedViaEvent(ctx.allTopics, ctx.completionEvent, ctx.requiredEvents)
  ) {
    return { action: "complete_event", outcome: "complete:completion_event" };
  }
  if (shouldContinueFromAcceptedEvent(ctx.emittedTopic, ctx.completionEvent)) {
    return { action: "continue_routed", outcome: "continue:routed_event" };
  }
  // The stdout promise is a fallback, not a self-grade: a substring match alone
  // must never finish a run. It is accepted only when the run also clears the
  // same gates the completion event must clear — no invalid events this turn,
  // every required event seen, and no open blocking tasks.
  if (
    !ctx.hadInvalidEvents &&
    !ctx.hasBlockingTasks &&
    requiredEventsSatisfied(ctx.allTopics, ctx.requiredEvents) &&
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

/** Every required-evidence event has been seen in the run so far. */
function requiredEventsSatisfied(
  topics: string[],
  requiredEvents: string[],
): boolean {
  return requiredEvents.every((e) => topics.includes(e));
}

function completedViaEvent(
  topics: string[],
  completionEvent: string,
  requiredEvents: string[],
): boolean {
  if (!topics.includes(completionEvent)) return false;
  return requiredEventsSatisfied(topics, requiredEvents);
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
