import { jsonField } from "../json.js";
import { registryComplete, registryStop } from "../registry/harness.js";
import {
  lastNChars,
  log,
  printFailureDiagnostic,
  printProgressLine,
} from "./display.js";
import { appendEvent } from "./journal.js";
import type { LoopContext, RunSummary } from "./types.js";

export function stopMaxIterations(
  loop: LoopContext,
  iteration: number,
): RunSummary {
  const completed = iteration <= 1 ? 0 : iteration - 1;
  log(
    loop,
    "warn",
    `loop stop reason=max_iterations completed_iterations=${completed} max_iterations=${loop.limits.maxIterations}`,
  );
  printProgressLine({
    runId: loop.runtime.runId,
    iteration: completed,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:max_iterations",
  });
  log(
    loop,
    "info",
    `Reached iteration limit: ${completed}/${loop.limits.maxIterations} iterations completed.`,
  );
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "max_iterations") +
      ", " +
      jsonField("completed_iterations", String(completed)) +
      ", " +
      jsonField("stopped_before_iteration", String(iteration)) +
      ", " +
      jsonField("max_iterations", String(loop.limits.maxIterations)),
  );
  registryStop(loop, completed, "max_iterations");
  return { iterations: completed, stopReason: "max_iterations" };
}

export function stopBackendFailed(
  loop: LoopContext,
  iteration: number,
  output: string,
): RunSummary {
  log(loop, "error", `loop stop reason=backend_failed iteration=${iteration}`);
  printProgressLine({
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:backend_failed",
  });
  printFailureDiagnostic(output, "backend_failed");
  const tail = lastNChars(output, 500);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", "backend_failed") +
      ", " +
      jsonField("iteration", String(iteration)) +
      ", " +
      jsonField("output_tail", tail),
  );
  registryStop(loop, iteration, "backend_failed");
  return { iterations: iteration, stopReason: "backend_failed" };
}

export function stopBackendTimeout(
  loop: LoopContext,
  iteration: number,
  output: string,
): RunSummary {
  log(loop, "error", `loop stop reason=backend_timeout iteration=${iteration}`);
  printProgressLine({
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:backend_timeout",
  });
  printFailureDiagnostic(output, "backend_timeout");
  const tail = lastNChars(output, 500);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", "backend_timeout") +
      ", " +
      jsonField("iteration", String(iteration)) +
      ", " +
      jsonField("output_tail", tail),
  );
  registryStop(loop, iteration, "backend_timeout");
  return { iterations: iteration, stopReason: "backend_timeout" };
}

export function completeLoop(
  loop: LoopContext,
  iteration: number,
  reason: string,
): RunSummary {
  log(loop, "info", `loop complete reason=${reason}`);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.complete",
    jsonField("reason", reason),
  );
  registryComplete(loop, iteration, reason);
  return { iterations: iteration, stopReason: reason };
}
