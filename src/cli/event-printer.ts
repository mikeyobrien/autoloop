// Default CLI event printer — converts LoopEvents back into terminal output
// via the legacy display helpers in harness/display.ts.
//
// The harness no longer calls display functions directly. dispatchRun
// installs this printer as the default onEvent for CLI runs; SDK consumers
// who want terminal output can import and use it too, while embedders
// ignore it and handle events themselves.

import {
  printBackendOutputTail,
  printFailureDiagnostic,
  printIterationBanner,
  printIterationFooter,
  printProgressLine,
  printReviewBanner,
  printSummary,
} from "../harness/display.js";
import type { LoopEvent } from "../harness/events.js";

export function cliPrintEvent(event: LoopEvent): void {
  switch (event.type) {
    case "log":
    case "iteration.start":
    case "loop.finish":
      // Already handled (log → stderr in display.ts) or SDK-only markers.
      return;
    case "iteration.banner":
      // display.ts only needs { iteration, allowedRoles, recentEvent,
      // allowedEvents, lastRejected } from iter and maxIterations from loop.
      printIterationBanner(
        { limits: { maxIterations: event.maxIterations } } as never,
        {
          iteration: event.iteration,
          allowedRoles: event.allowedRoles,
          recentEvent: event.recentEvent,
          allowedEvents: event.allowedEvents,
          lastRejected: event.lastRejected ?? "",
        } as never,
      );
      return;
    case "iteration.footer":
      printIterationFooter(
        { iteration: event.iteration } as never,
        event.elapsedS,
      );
      return;
    case "progress":
      printProgressLine({
        runId: event.runId,
        iteration: event.iteration,
        recentEvent: event.recentEvent,
        allowedRoles: event.allowedRoles,
        emittedTopic: event.emittedTopic,
        outcome: event.outcome,
      });
      return;
    case "review.banner":
      printReviewBanner(event.iteration);
      return;
    case "backend.output":
      printBackendOutputTail(event.output, event.maxLines);
      return;
    case "failure.diagnostic":
      printFailureDiagnostic(event.output, event.stopReason);
      return;
    case "summary":
      printSummary(
        {
          iterations: event.iterations,
          stopReason: event.stopReason,
          runId: event.runId,
        },
        {
          runtime: { runId: event.runId },
          paths: {
            journalFile: event.journalFile,
            memoryFile: event.memoryFile,
            toolPath: event.toolPath,
          },
          review: { every: event.reviewEvery },
        } as never,
      );
      return;
  }
}
