import { jsonField, jsonFieldRaw, jsonBool } from "../json.js";
import { readRunLines, appendEvent } from "./journal.js";
import { renderReviewPromptText } from "./prompt.js";
import type { LoopContext } from "./types.js";
import { printReviewBanner } from "./display.js";
import { buildReviewCommand, runProcess } from "./parallel.js";
import { reloadLoop } from "./config-helpers.js";

export function maybeRunMetareview(loop: LoopContext, iteration: number): LoopContext {
  if (shouldRunMetareview(loop, iteration)) {
    runMetareviewReview(loop, iteration);
    return reloadLoop(loop);
  }
  return loop;
}

export function shouldRunMetareview(loop: LoopContext, iteration: number): boolean {
  return loop.review.enabled && iteration > 1 && (iteration - 1) % loop.review.every === 0;
}

export function runMetareviewReview(loop: LoopContext, iteration: number): void {
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
    loop.review.kind,
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
