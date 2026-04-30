import { runKiroIteration } from "@mobrienv/autoloop-backends";
import { listText } from "@mobrienv/autoloop-core";
import {
  extractField,
  extractIteration,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { log } from "./display.js";
import {
  appendInvalidEvent,
  invalidEvent,
  parallelTriggerTopic,
  systemTopic,
} from "./emit.js";
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
import { completeLoop, stopBackendFailed, stopBackendTimeout } from "./stop.js";
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
  const iter = buildIterationContext(loop, iteration);
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
  log(loop, "debug", `backend start command=${loop.backend.command}`);

  const startEpoch = Math.floor(Date.now() / 1000);

  // Switch Kiro session agent mode per-role if agents.toml provides a mapping.
  // Failure is non-fatal — the role just runs with the default agent.
  if (iter.roleAgent && loop.backend.kind === "kiro" && loop.kiroSession) {
    log(
      loop,
      "debug",
      `switching kiro agent to "${iter.roleAgent}" for role "${iter.allowedRoles[0]}"`,
    );
    try {
      await loop.kiroSession.connection.setSessionMode({
        sessionId: loop.kiroSession.sessionId,
        modeId: iter.roleAgent,
      });
    } catch (err: unknown) {
      process.stderr.write(
        `[autoloop] warning: failed to set kiro agent mode "${iter.roleAgent}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const { output, exitCode, timedOut } =
    loop.backend.kind === "kiro" && loop.kiroSession
      ? await runKiroIteration(
          loop.kiroSession,
          iter.prompt,
          loop.backend.timeoutMs,
        )
      : runProcess(
          buildBackendCommand(loop, iter),
          loop.backend.timeoutMs,
          loop.backend.kind,
        );
  const elapsedS = Math.floor(Date.now() / 1000) - startEpoch;

  appendBackendFinish(loop, iter, output, exitCode, timedOut);
  appendIterationFinish(loop, iter, output, exitCode, timedOut, elapsedS);
  registryProgress(loop, iteration);
  log(loop, "debug", `iteration ${iteration} finish exit_code=${exitCode}`);
  loop.onEvent?.({
    type: "iteration.footer",
    iteration: iter.iteration,
    elapsedS,
  });
  loop.onEvent?.({ type: "backend.output", output });

  if (timedOut) return stopBackendTimeout(loop, iteration, output);
  if (exitCode !== 0) return stopBackendFailed(loop, iteration, output);
  return finishIteration(loop, iter, output, iterate);
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

function rejectInvalidAndContinue(
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

function finishParallelIteration(
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
