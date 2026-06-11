import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { lastNChars, log } from "./display.js";
import { registryComplete, registryStop } from "./registry-bridge.js";
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
  loop.onEvent?.({
    type: "progress",
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
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:backend_failed",
  });
  loop.onEvent?.({
    type: "failure.diagnostic",
    output,
    stopReason: "backend_failed",
  });
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
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:backend_timeout",
  });
  loop.onEvent?.({
    type: "failure.diagnostic",
    output,
    stopReason: "backend_timeout",
  });
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

export function stopStalled(
  loop: LoopContext,
  completed: number,
  repeats: number,
): RunSummary {
  log(
    loop,
    "warn",
    `loop stop reason=stalled identical_outputs=${repeats} threshold=${loop.limits.stallIterations ?? 0}`,
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration: completed,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:stalled",
  });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "stalled") +
      ", " +
      jsonField("completed_iterations", String(completed)) +
      ", " +
      jsonField("identical_outputs", String(repeats)) +
      ", " +
      jsonField("stall_iterations", String(loop.limits.stallIterations ?? 0)),
  );
  registryStop(loop, completed, "stalled");
  return { iterations: completed, stopReason: "stalled" };
}

export function stopCostBudget(
  loop: LoopContext,
  completed: number,
  costUsd: number,
  maxCostUsd: number,
): RunSummary {
  log(
    loop,
    "warn",
    `loop stop reason=cost_budget cost_usd=${costUsd.toFixed(4)} max_cost_usd=${maxCostUsd}`,
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration: completed,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:cost_budget",
  });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "cost_budget") +
      ", " +
      jsonField("completed_iterations", String(completed)) +
      ", " +
      jsonField("cost_usd", costUsd.toFixed(6)) +
      ", " +
      jsonField("max_cost_usd", String(maxCostUsd)),
  );
  registryStop(loop, completed, "cost_budget");
  return { iterations: completed, stopReason: "cost_budget" };
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
