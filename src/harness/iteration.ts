import { listText } from "../utils.js";
import { readRunLines, extractTopic, extractField, extractIteration } from "./journal.js";
import { invalidEvent, systemTopic, parallelTriggerTopic, appendInvalidEvent } from "./emit.js";
import { buildIterationContext } from "./prompt.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext, RunSummary } from "./types.js";
import { executeParallelWave, continueAfterParallelJoin, stopAfterParallelWave } from "./wave.js";
import {
  printIterationBanner,
  printIterationFooter,
  printProgressLine,
  log,
} from "./display.js";
import {
  buildBackendCommand,
  appendIterationStart,
  appendBackendStart,
  appendBackendFinish,
  appendIterationFinish,
  runProcess,
} from "./parallel.js";
import { stopBackendFailed, stopBackendTimeout, completeLoop } from "./stop.js";
import { registryProgress } from "../registry/harness.js";

export function runIteration(
  loop: LoopContext,
  iteration: number,
  iterate: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const iter = buildIterationContext(loop, iteration);
  printIterationBanner(loop, iter);
  appendIterationStart(loop, iter);
  log(loop, "debug", `iteration ${iteration} start`);
  appendBackendStart(loop, iter);
  log(loop, "debug", `backend start command=${loop.backend.command}`);

  const startEpoch = Math.floor(Date.now() / 1000);
  const { output, exitCode, timedOut } = runProcess(
    buildBackendCommand(loop, iter),
    loop.backend.timeoutMs,
    loop.backend.kind,
  );
  const elapsedS = Math.floor(Date.now() / 1000) - startEpoch;

  appendBackendFinish(loop, iter, output, exitCode, timedOut);
  appendIterationFinish(loop, iter, output, exitCode, timedOut, elapsedS);
  registryProgress(loop, iteration);
  log(loop, "debug", `iteration ${iteration} finish exit_code=${exitCode}`);
  printIterationFooter(iter, elapsedS);

  if (timedOut) return stopBackendTimeout(loop, iteration, output);
  if (exitCode !== 0) return stopBackendFailed(loop, iteration, output);
  return finishIteration(loop, iter, output, iterate);
}

export function finishIteration(
  loop: LoopContext,
  iter: IterationContext,
  output: string,
  iterate: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const allTopics = runLines.map(extractTopic).filter((t) => t !== "");
  const turnLines = runLines.filter((l) => extractIteration(l) === String(iter.iteration));
  const emitted = latestAgentEventRecord(turnLines);

  if (invalidEvent(emitted.topic, iter.allowedEvents, loop.parallel.enabled, loop.completion.event)) {
    return rejectInvalidAndContinue(loop, iter, emitted.topic, iterate);
  }

  if (parallelTriggerTopic(emitted.topic)) {
    return finishParallelIteration(loop, iter, emitted.topic, emitted.payload, iterate);
  }

  if (completedViaEvent(allTopics, loop.completion.event, loop.completion.requiredEvents)) {
    printProgressLine({
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      recentEvent: iter.recentEvent,
      allowedRoles: iter.allowedRoles,
      emittedTopic: emitted.topic,
      outcome: "complete:completion_event",
    });
    return completeLoop(loop, iter.iteration, "completion_event");
  }

  if (shouldContinueFromAcceptedEvent(emitted.topic, loop.completion.event)) {
    printProgressLine({
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      recentEvent: iter.recentEvent,
      allowedRoles: iter.allowedRoles,
      emittedTopic: emitted.topic,
      outcome: "continue:routed_event",
    });
    return iterate(loop, iter.iteration + 1);
  }

  if (completedViaPromise(output, loop.completion.promise)) {
    printProgressLine({
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      recentEvent: iter.recentEvent,
      allowedRoles: iter.allowedRoles,
      emittedTopic: emitted.topic,
      outcome: "complete:completion_promise",
    });
    return completeLoop(loop, iter.iteration, "completion_promise");
  }

  printProgressLine({
    runId: loop.runtime.runId,
    iteration: iter.iteration,
    recentEvent: iter.recentEvent,
    allowedRoles: iter.allowedRoles,
    emittedTopic: emitted.topic,
    outcome: "continue",
  });
  return iterate(loop, iter.iteration + 1);
}

function rejectInvalidAndContinue(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  iterate: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  appendInvalidEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    iter.recentEvent,
    emittedTopic,
    iter.allowedRoles,
    iter.allowedEvents,
  );
  console.log(
    `[reject] invalid event \`${emittedTopic}\`; recent event: \`${iter.recentEvent}\`; allowed next events: ${listText(iter.allowedEvents)}`,
  );
  printProgressLine({
    runId: loop.runtime.runId,
    iteration: iter.iteration,
    recentEvent: iter.recentEvent,
    allowedRoles: iter.allowedRoles,
    emittedTopic,
    outcome: "rejected:event.invalid",
  });
  return iterate(loop, iter.iteration + 1);
}

function finishParallelIteration(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  emittedPayload: string,
  iterate: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const result = executeParallelWave(loop, iter, emittedTopic, emittedPayload);

  if (result.reason === "parallel_wave_complete") {
    printProgressLine({
      runId: loop.runtime.runId,
      iteration: iter.iteration,
      recentEvent: iter.recentEvent,
      allowedRoles: iter.allowedRoles,
      emittedTopic,
      outcome: "parallel:joined",
    });
    return continueAfterParallelJoin(loop, iter, result.waveId, emittedTopic, result.elapsedMs, iterate);
  }
  printProgressLine({
    runId: loop.runtime.runId,
    iteration: iter.iteration,
    recentEvent: iter.recentEvent,
    allowedRoles: iter.allowedRoles,
    emittedTopic,
    outcome: `parallel:stop:${result.reason}`,
  });
  return stopAfterParallelWave(loop, iter, result.reason, result.waveId);
}

function latestAgentEventRecord(lines: string[]): { topic: string; payload: string } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const topic = extractTopic(lines[i]);
    if (!systemTopic(topic)) {
      return { topic, payload: extractField(lines[i], "payload") };
    }
  }
  return { topic: "", payload: "" };
}

function completedViaEvent(topics: string[], completionEvent: string, requiredEvents: string[]): boolean {
  if (!topics.includes(completionEvent)) return false;
  return requiredEvents.every((e) => topics.includes(e));
}

function completedViaPromise(output: string, promise: string): boolean {
  if (!promise) return false;
  return output.includes(promise);
}

function shouldContinueFromAcceptedEvent(emittedTopic: string, completionEvent: string): boolean {
  if (!emittedTopic) return false;
  return emittedTopic !== completionEvent;
}
