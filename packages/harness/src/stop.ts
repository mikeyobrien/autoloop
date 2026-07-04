import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { lastNChars, log } from "./display.js";
import { registryComplete, registryStop } from "./registry-bridge.js";
import type { LoopContext, RunSummary, StopReason } from "./types.js";

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

/**
 * Stop with a typed backend-error reason (rate_limited / quota_exhausted /
 * auth_failed / transient_error) instead of a generic backend_failed, so the
 * disposition reflects an availability/auth/quota issue rather than an agent
 * failure — and downstream (retry ladder, quarantine) can key off it.
 */
export function stopBackendErrorClass(
  loop: LoopContext,
  iteration: number,
  reason: StopReason,
  output: string,
): RunSummary {
  log(loop, "error", `loop stop reason=${reason} iteration=${iteration}`);
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: `stop:${reason}`,
  });
  loop.onEvent?.({ type: "failure.diagnostic", output, stopReason: reason });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", reason) +
      ", " +
      jsonField("iteration", String(iteration)) +
      ", " +
      jsonField("output_tail", lastNChars(output, 500)),
  );
  registryStop(loop, iteration, reason);
  return { iterations: iteration, stopReason: reason };
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

export function stopMaxRuntime(
  loop: LoopContext,
  completed: number,
  elapsedMs: number,
  maxRuntimeMs: number,
  outputTail?: string,
): RunSummary {
  log(
    loop,
    "warn",
    `loop stop reason=max_runtime elapsed_ms=${elapsedMs} max_runtime_ms=${maxRuntimeMs}`,
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration: completed,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:max_runtime",
  });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "max_runtime") +
      ", " +
      jsonField("completed_iterations", String(completed)) +
      ", " +
      jsonField("elapsed_ms", String(elapsedMs)) +
      ", " +
      jsonField("max_runtime_ms", String(maxRuntimeMs)) +
      (outputTail !== undefined
        ? ", " + jsonField("output_tail", lastNChars(outputTail, 500))
        : ""),
  );
  registryStop(loop, completed, "max_runtime");
  return { iterations: completed, stopReason: "max_runtime" };
}

/**
 * Fail-closed stop for an UNKNOWN metareview verdict under `on_error = hold`.
 * The reviewer gave no trustworthy signal, so the loop halts and raises
 * attention (failure.diagnostic + notify-class "failed") instead of silently
 * advancing — a human decides whether to resume.
 */
export function stopReviewUnknown(
  loop: LoopContext,
  iteration: number,
  reasoning: string,
): RunSummary {
  log(
    loop,
    "warn",
    `loop stop reason=review_unknown iteration=${iteration} detail=${reasoning}`,
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:review_unknown",
  });
  loop.onEvent?.({
    type: "failure.diagnostic",
    output: `Metareview returned UNKNOWN and held the loop: ${reasoning}`,
    stopReason: "review_unknown",
  });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "loop.stop",
    jsonField("reason", "review_unknown") +
      ", " +
      jsonField("iteration", String(iteration)) +
      ", " +
      jsonField("detail", reasoning),
  );
  registryStop(loop, iteration, "review_unknown");
  return { iterations: iteration, stopReason: "review_unknown" };
}

/**
 * Escalate a premature quit that exhausted its re-arm budget: stop with a
 * distinct reason and raise attention rather than silently accepting a
 * false-finish that left authorized work undone.
 */
export function stopPrematureQuit(
  loop: LoopContext,
  completed: number,
  reasons: string[],
): RunSummary {
  log(
    loop,
    "warn",
    `loop stop reason=premature_quit completed_iterations=${completed} remaining=${reasons.join("; ")}`,
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration: completed,
    recentEvent: "loop.stop",
    allowedRoles: [],
    outcome: "stop:premature_quit",
  });
  loop.onEvent?.({
    type: "failure.diagnostic",
    output: `Premature quit: authorized work remained with no blocker and the re-arm budget was exhausted.\nRemaining:\n- ${reasons.join("\n- ")}`,
    stopReason: "premature_quit",
  });
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.stop",
    jsonField("reason", "premature_quit") +
      ", " +
      jsonField("completed_iterations", String(completed)) +
      ", " +
      jsonField("remaining", reasons.join("; ")),
  );
  registryStop(loop, completed, "premature_quit");
  return { iterations: completed, stopReason: "premature_quit" };
}

export function completeLoop(
  loop: LoopContext,
  iteration: number,
  reason: StopReason,
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
