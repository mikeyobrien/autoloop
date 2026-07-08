import { joinCsv, jsonField } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendHarnessEvent,
} from "@mobrienv/autoloop-core/journal";
import * as topology from "@mobrienv/autoloop-core/topology";
import { parallelDispatchBase, parallelJoinedTopic } from "../emit.js";
import type { IterationContext } from "../prompt.js";
import type { LoopContext, RunSummary } from "../types.js";
import type {
  AggregateConfig,
  AggregateOutcome,
  BranchResult,
  IterateFn,
} from "./types.js";

/**
 * Finalize a joined wave under its configured aggregate strategy.
 *  - `wait_for_all` (default): unchanged semantics — any branch timeout or
 *    non-success stop reason fails the whole wave.
 *  - `first_success`: the wave completes as soon as ONE branch succeeds, even
 *    though its siblings were cancelled (not treated as failures).
 *  - `timeout`: if the wall-clock deadline was hit, the wave completes if at
 *    least one branch had already succeeded, else it is a wave timeout.
 */
export function finalizeParallelWave(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  results: BranchResult[],
  aggregate: AggregateConfig,
  aggregateOutcome: AggregateOutcome,
): { reason: string; waveId: string } {
  appendWaveAggregate(loop, iter, waveId, aggregate, aggregateOutcome);

  if (aggregate.mode === "first_success") {
    if (aggregateOutcome.satisfiedByBranchId) {
      return { reason: "parallel_wave_complete", waveId };
    }
    return finalizeNoSuccess(loop, iter, waveId, results);
  }

  if (aggregate.mode === "timeout" && aggregateOutcome.aggregateTimedOut) {
    const anySucceeded = results.some((r) => branchSuccessStatus(r.stopReason));
    if (anySucceeded) return { reason: "parallel_wave_complete", waveId };
    return finalizeNoSuccess(loop, iter, waveId, results);
  }

  // wait_for_all (default), or timeout mode that resolved before its deadline.
  const timedOut = results
    .filter((r) => r.stopReason === "backend_timeout")
    .map((r) => r.branchId);
  if (timedOut.length > 0) {
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iter.iteration),
      "wave.timeout",
      jsonField("wave_id", waveId) +
        ", " +
        jsonField("timed_out_branches", joinCsv(timedOut)),
    );
    return { reason: "parallel_wave_timeout", waveId };
  }
  const failed = results
    .filter((r) => !branchSuccessStatus(r.stopReason))
    .map((r) => r.branchId);
  if (failed.length > 0) {
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iter.iteration),
      "wave.failed",
      jsonField("wave_id", waveId) +
        ", " +
        jsonField("failed_branches", joinCsv(failed)),
    );
    return { reason: "parallel_wave_failed", waveId };
  }
  return { reason: "parallel_wave_complete", waveId };
}

/** No branch succeeded (first_success/timeout modes without a winner):
 * prefer a `wave.timeout` verdict when any branch actually timed out
 * (backend- or aggregate-level), otherwise `wave.failed`. */
function finalizeNoSuccess(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  results: BranchResult[],
): { reason: string; waveId: string } {
  const timedOut = results
    .filter(
      (r) =>
        r.stopReason === "backend_timeout" ||
        r.stopReason === "wave_aggregate_timeout",
    )
    .map((r) => r.branchId);
  if (timedOut.length > 0) {
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iter.iteration),
      "wave.timeout",
      jsonField("wave_id", waveId) +
        ", " +
        jsonField("timed_out_branches", joinCsv(timedOut)),
    );
    return { reason: "parallel_wave_timeout", waveId };
  }
  const failed = results
    .filter((r) => !branchSuccessStatus(r.stopReason))
    .map((r) => r.branchId);
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.failed",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("failed_branches", joinCsv(failed)),
  );
  return { reason: "parallel_wave_failed", waveId };
}

function appendWaveAggregate(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  aggregate: AggregateConfig,
  aggregateOutcome: AggregateOutcome,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.aggregate",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("mode", aggregate.mode) +
      ", " +
      jsonField(
        "satisfied_by_branch_id",
        aggregateOutcome.satisfiedByBranchId ?? "",
      ) +
      ", " +
      jsonField(
        "aggregate_timed_out",
        String(aggregateOutcome.aggregateTimedOut),
      ),
  );
}

export function branchSuccessStatus(status: string): boolean {
  return (
    status === "max_iterations" ||
    status === "completion_event" ||
    status === "completion_promise"
  );
}

export async function continueAfterParallelJoin(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  emittedTopic: string,
  totalElapsedMs: number,
  iterateFn: IterateFn,
): Promise<RunSummary> {
  const joinedTopic = parallelJoinedTopic(emittedTopic);
  appendWaveJoinFinish(
    loop,
    iter,
    waveId,
    emittedTopic,
    joinedTopic,
    totalElapsedMs,
  );
  appendHarnessEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    joinedTopic,
    waveId,
  );
  return iterateFn(loop, iter.iteration + 1);
}

export function stopAfterParallelWave(
  loop: LoopContext,
  iter: IterationContext,
  reason: string,
  waveId: string,
): RunSummary {
  const fields =
    jsonField("reason", reason) +
    ", " +
    jsonField("iteration", String(iter.iteration)) +
    (waveId ? `, ${jsonField("wave_id", waveId)}` : "");
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "loop.stop",
    fields,
  );
  return { iterations: iter.iteration, stopReason: reason };
}

function joinedResumeRoutingBasis(
  iter: IterationContext,
  emittedTopic: string,
): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return parallelDispatchBase(emittedTopic) || iter.recentEvent;
}

function joinedResumeRecentEvent(
  iter: IterationContext,
  emittedTopic: string,
  joinedTopic: string,
): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return joinedTopic;
}

function joinedResumeRoles(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  routingBasis: string,
): string[] {
  if (emittedTopic === "explore.parallel") return iter.allowedRoles;
  return topology.suggestedRoles(loop.topology, routingBasis);
}

function joinedResumeEvents(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  routingBasis: string,
): string[] {
  if (emittedTopic === "explore.parallel") return iter.allowedEvents;
  return topology.allowedEvents(loop.topology, routingBasis);
}

function appendWaveJoinFinish(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  emittedTopic: string,
  joinedTopic: string,
  totalElapsed: number,
): void {
  const routingBasis = joinedResumeRoutingBasis(iter, emittedTopic);
  const resumeRecentEvent = joinedResumeRecentEvent(
    iter,
    emittedTopic,
    joinedTopic,
  );
  const resumeRoles = joinedResumeRoles(loop, iter, emittedTopic, routingBasis);
  const resumeEvents = joinedResumeEvents(
    loop,
    iter,
    emittedTopic,
    routingBasis,
  );
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.join.finish",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("trigger_topic", emittedTopic) +
      ", " +
      jsonField("joined_topic", joinedTopic) +
      ", " +
      jsonField("routing_basis", routingBasis) +
      ", " +
      jsonField("resume_recent_event", resumeRecentEvent) +
      ", " +
      jsonField("resume_roles", joinCsv(resumeRoles)) +
      ", " +
      jsonField("resume_events", joinCsv(resumeEvents)) +
      ", " +
      jsonField("elapsed_ms", String(totalElapsed)),
  );
}
