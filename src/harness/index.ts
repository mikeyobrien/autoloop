import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonField, jsonFieldRaw, jsonBool } from "../json.js";
import { listText } from "../utils.js";
import {
  appendEvent,
  readRunLines,
  extractTopic,
  extractField,
  extractIteration,
  readIfExists,
} from "./journal.js";
import {
  emit as emitCmd,
  resolveEmitJournalFile,
  invalidEvent,
  systemTopic,
  parallelTriggerTopic,
  appendInvalidEvent,
} from "./emit.js";
import { renderRunScratchpadFull } from "./scratchpad.js";
import {
  buildIterationContext,
  renderReviewPromptText,
} from "./prompt.js";
import type { IterationContext } from "./prompt.js";
import { coordinationFromLines } from "./coordination.js";
import { collectMetricsRows, formatMetrics } from "./metrics.js";
import type { LoopContext, RunOptions, RunSummary } from "./types.js";
import {
  loadParallelBranchLaunch,
  parallelBranchBackendOverride,
  writeParallelBranchSummary,
  renderBranchResult,
  seedBranchContext,
  branchStopReason,
  runProcess,
  buildBackendCommand,
  buildReviewCommand,
  appendLoopStart,
  appendIterationStart,
  appendBackendStart,
  appendBackendFinish,
  appendIterationFinish,
} from "./parallel.js";
import {
  executeParallelWave,
  continueAfterParallelJoin,
  stopAfterParallelWave,
} from "./wave.js";
import {
  printSummary,
  printIterationBanner,
  printIterationFooter,
  printReviewBanner,
  printFailureDiagnostic,
  lastNChars,
  log,
  printProjectedMarkdown,
  printProjectedText,
} from "./display.js";
import {
  ensureLayout,
  installRuntimeTools,
  iterationFieldForRun,
  ensureRenderRunId,
  emptyFallback,
  buildLoopContext,
  reloadLoop,
  applyRuntimeModeOverrides,
  initStore,
} from "./config-helpers.js";

export type { LoopContext, RunOptions, RunSummary };

export function run(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): RunSummary {
  let loop = buildLoopContext(projectDir, promptOverride, selfCommand, runOptions);
  loop = reloadLoop(loop);
  loop = initStore(loop);
  ensureLayout(loop.paths.stateDir);
  installRuntimeTools(loop);
  appendLoopStart(loop);
  log(loop, "info", `loop start run_id=${loop.runtime.runId} max_iterations=${loop.limits.maxIterations}`);
  const summary = iterate(loop, 1);
  printSummary(summary, loop);
  return summary;
}

export { emitCmd as emit };

export function renderScratchpadFormat(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  printProjectedMarkdown(
    emptyFallback(renderRunScratchpadFull(readRunLines(journalFile, runId))),
    format,
  );
}

export function renderPromptFormat(
  projectDir: string,
  iteration: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const prompt = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.start",
    "prompt",
  );
  if (!prompt) {
    console.log(`missing prompt projection for iteration ${iteration}`);
    return;
  }
  printProjectedMarkdown(prompt, format);
}

export function renderOutput(
  projectDir: string,
  iteration: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const output = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.finish",
    "output",
  );
  console.log(output || `missing output projection for iteration ${iteration}`);
}

export function renderJournal(projectDir: string): void {
  console.log(readIfExists(resolveEmitJournalFile(projectDir)));
}

export function renderCoordinationFormat(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const lines = readRunLines(journalFile, runId);
  printProjectedMarkdown(emptyFallback(coordinationFromLines(lines)), format);
}

export function renderMetrics(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const lines = readRunLines(journalFile, runId);
  const rows = collectMetricsRows(lines);
  printProjectedText(formatMetrics(rows, format), format);
}

export function renderMetricsForRun(
  projectDir: string,
  runId: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const lines = readRunLines(journalFile, runId);
  const rows = collectMetricsRows(lines);
  printProjectedText(formatMetrics(rows, format), format);
}

export function runParallelBranchCli(
  projectDir: string,
  branchDir: string,
  selfCommand: string,
): void {
  const launch = loadParallelBranchLaunch(branchDir);
  const branchPrompt = launch.prompt;
  const routingEvent = launch.routingEvent || "loop.start";
  const backendOverride = parallelBranchBackendOverride(launch);
  const logLevelVal = launch.logLevel || null;
  let branchLoop = buildLoopContext(projectDir, branchPrompt, selfCommand, {
    workDir: branchDir,
    backendOverride,
    logLevel: logLevelVal,
  });
  branchLoop = reloadLoop(branchLoop);
  branchLoop = initStore(branchLoop);
  branchLoop.runtime.branchMode = true;
  branchLoop = applyRuntimeModeOverrides(branchLoop);
  ensureLayout(branchLoop.paths.stateDir);
  installRuntimeTools(branchLoop);
  appendLoopStart(branchLoop);

  const seeded = seedBranchContext(branchLoop, routingEvent);
  const startMs = Date.now();
  const summary = iterate(seeded, 1);
  const finishedMs = Date.now();
  const elapsedMs = finishedMs - startMs;
  const output = iterationFieldForRun(
    seeded.paths.journalFile,
    seeded.runtime.runId,
    "1",
    "iteration.finish",
    "output",
  );
  const stopReason = branchStopReason(summary.stopReason, elapsedMs, seeded.parallel.branchTimeoutMs);

  const result = {
    branch_id: launch.branchId,
    objective: launch.objective,
    stop_reason: stopReason,
    output,
    routing_event: routingEvent,
    allowed_roles: launch.allowedRoles,
    allowed_events: launch.allowedEvents,
    branch_dir: branchDir,
    elapsed_ms: elapsedMs,
    finished_at_ms: finishedMs,
  };

  writeFileSync(join(branchDir, "result.md"), renderBranchResult(result));
  writeParallelBranchSummary(branchDir, result);
}

// --- Private implementation ---

function iterate(loop: LoopContext, iteration: number): RunSummary {
  const liveLoop = reloadLoop(loop);
  installRuntimeTools(liveLoop);
  const reviewed = maybeRunMetareview(liveLoop, iteration);

  if (iteration > reviewed.limits.maxIterations) {
    return stopMaxIterations(reviewed, iteration);
  }
  return runIteration(reviewed, iteration);
}

function maybeRunMetareview(loop: LoopContext, iteration: number): LoopContext {
  if (shouldRunMetareview(loop, iteration)) {
    runMetareviewReview(loop, iteration);
    return reloadLoop(loop);
  }
  return loop;
}

function shouldRunMetareview(loop: LoopContext, iteration: number): boolean {
  return (
    loop.review.enabled &&
    iteration > 1 &&
    (iteration - 1) % loop.review.every === 0
  );
}

function runMetareviewReview(loop: LoopContext, iteration: number): void {
  printReviewBanner(iteration);
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const reviewPrompt = renderReviewPromptText(loop, iteration, runLines);

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "review.start",
    jsonField("kind", "metareview") +
      ", " + jsonField("backend_kind", loop.review.kind) +
      ", " + jsonField("command", loop.review.command) +
      ", " + jsonField("prompt_mode", loop.review.promptMode) +
      ", " + jsonField("prompt", reviewPrompt) +
      ", " + jsonField("timeout_ms", String(loop.review.timeoutMs)),
  );

  const { output, exitCode, timedOut } = runProcess(
    buildReviewCommand(loop, iteration, reviewPrompt),
    loop.review.timeoutMs,
  );

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "review.finish",
    jsonField("kind", "metareview") +
      ", " + jsonField("exit_code", String(exitCode)) +
      ", " + jsonFieldRaw("timed_out", jsonBool(timedOut)) +
      ", " + jsonField("output", output),
  );
}

function runIteration(loop: LoopContext, iteration: number): RunSummary {
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
  );
  const elapsedS = Math.floor(Date.now() / 1000) - startEpoch;

  appendBackendFinish(loop, iter, output, exitCode, timedOut);
  appendIterationFinish(loop, iter, output, exitCode, timedOut, elapsedS);
  log(loop, "debug", `iteration ${iteration} finish exit_code=${exitCode}`);
  printIterationFooter(iter, elapsedS);

  if (timedOut) return stopBackendTimeout(loop, iteration, output);
  if (exitCode !== 0) return stopBackendFailed(loop, iteration, output);
  return finishIteration(loop, iter, output);
}

function finishIteration(
  loop: LoopContext,
  iter: IterationContext,
  output: string,
): RunSummary {
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const allTopics = runLines.map(extractTopic).filter((t) => t !== "");
  const turnLines = runLines.filter(
    (l) => extractIteration(l) === String(iter.iteration),
  );
  const emitted = latestAgentEventRecord(turnLines);

  if (
    invalidEvent(
      emitted.topic,
      iter.allowedEvents,
      loop.parallel.enabled,
      loop.completion.event,
    )
  ) {
    return rejectInvalidAndContinue(loop, iter, emitted.topic);
  }

  if (parallelTriggerTopic(emitted.topic)) {
    return finishParallelIteration(loop, iter, emitted.topic, emitted.payload);
  }

  if (
    completedViaEvent(
      allTopics,
      loop.completion.event,
      loop.completion.requiredEvents,
    )
  ) {
    return completeLoop(loop, iter.iteration, "completion_event");
  }

  if (completedViaPromise(output, loop.completion.promise)) {
    return completeLoop(loop, iter.iteration, "completion_promise");
  }

  return iterate(loop, iter.iteration + 1);
}

function rejectInvalidAndContinue(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
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
  return iterate(loop, iter.iteration + 1);
}

function finishParallelIteration(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  emittedPayload: string,
): RunSummary {
  const result = executeParallelWave(loop, iter, emittedTopic, emittedPayload);

  if (result.reason === "parallel_wave_complete") {
    return continueAfterParallelJoin(loop, iter, result.waveId, emittedTopic, result.elapsedMs, iterate);
  }
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

function stopMaxIterations(loop: LoopContext, iteration: number): RunSummary {
  const completed = iteration <= 1 ? 0 : iteration - 1;
  log(loop, "warn", `loop stop reason=max_iterations completed_iterations=${completed} max_iterations=${loop.limits.maxIterations}`);
  console.log(`Reached iteration limit: ${completed}/${loop.limits.maxIterations} iterations completed.`);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "max_iterations") +
      ", " + jsonField("completed_iterations", String(completed)) +
      ", " + jsonField("stopped_before_iteration", String(iteration)) +
      ", " + jsonField("max_iterations", String(loop.limits.maxIterations)),
  );
  return { iterations: completed, stopReason: "max_iterations" };
}

function stopBackendFailed(loop: LoopContext, iteration: number, output: string): RunSummary {
  log(loop, "error", `loop stop reason=backend_failed iteration=${iteration}`);
  printFailureDiagnostic(output, "backend_failed");
  const tail = lastNChars(output, 500);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", "backend_failed") +
      ", " + jsonField("iteration", String(iteration)) +
      ", " + jsonField("output_tail", tail),
  );
  return { iterations: iteration, stopReason: "backend_failed" };
}

function stopBackendTimeout(loop: LoopContext, iteration: number, output: string): RunSummary {
  log(loop, "error", `loop stop reason=backend_timeout iteration=${iteration}`);
  printFailureDiagnostic(output, "backend_timeout");
  const tail = lastNChars(output, 500);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", "backend_timeout") +
      ", " + jsonField("iteration", String(iteration)) +
      ", " + jsonField("output_tail", tail),
  );
  return { iterations: iteration, stopReason: "backend_timeout" };
}

function completeLoop(loop: LoopContext, iteration: number, reason: string): RunSummary {
  log(loop, "info", `loop complete reason=${reason}`);
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iteration), "loop.complete", jsonField("reason", reason));
  return { iterations: iteration, stopReason: reason };
}


