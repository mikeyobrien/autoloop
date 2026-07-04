// Wires fan-out `[[stage]]` execution into the iteration loop. Mirrors
// `wave.ts`'s `continueAfterParallelJoin`: run the stage to a reduced routing
// decision, journal it, emit the outcome event, and continue routing through
// the SAME topology handoff every other event uses — the stage's `onPass`/
// `onFail` are plain declared events, so the loop gains no special routing
// path once the stage has finished.

import { jsonField } from "@mobrienv/autoloop-core";
import type {
  BranchResult as FanoutBranchResult,
  FanoutStage,
} from "@mobrienv/autoloop-core/fanout";
import {
  appendEvent,
  appendHarnessEvent,
  extractField,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { runCostUsd } from "./display.js";
import type { BranchRunner, BranchSpec } from "./fanout-runner.js";
import { expandStageBranches, runFanoutStage } from "./fanout-runner.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext, RunSummary } from "./types.js";
import { buildStageBranchRunner } from "./wave/stage-branch-runner.js";

type IterateFn = (loop: LoopContext, iteration: number) => Promise<RunSummary>;

/**
 * Best-effort advisory cost-per-branch estimate, when a budget ceiling is set:
 * spend-so-far divided by iterations completed so far (floored at a small
 * constant so a still-cheap early run does not admit an unbounded wave).
 * Command backends that never journal `backend.usage` report zero spend, so
 * the ceiling is a no-op for them — documented as advisory/best-effort.
 */
function perBranchCostEstimate(loop: LoopContext, iteration: number): number {
  const spent = runCostUsd(loop);
  if (spent <= 0) return 0;
  return Math.max(spent / Math.max(1, iteration), 0.01);
}

/**
 * Which branches the budget ceiling admits this wave. When no ceiling is set
 * (`maxCostUsd` is 0), every branch is admitted — width is bounded only by the
 * concurrency semaphore. When a ceiling is set, branches are admitted up to
 * what the remaining budget covers at the per-branch estimate; the rest are
 * skipped (never launched) rather than launched and killed mid-flight —
 * "stop admitting past the line, overshoot bounded by one wave".
 */
function admitByBudget(
  loop: LoopContext,
  iter: IterationContext,
  specs: BranchSpec[],
): Set<string> {
  const ceiling = loop.limits.maxCostUsd ?? 0;
  if (ceiling <= 0) return new Set(specs.map((s) => s.branchId));

  const spent = runCostUsd(loop);
  const remaining = Math.max(ceiling - spent, 0);
  const perBranch = perBranchCostEstimate(loop, iter.iteration);
  if (perBranch <= 0) return new Set(specs.map((s) => s.branchId));

  const admitted = Math.max(0, Math.floor(remaining / perBranch));
  return new Set(specs.slice(0, admitted).map((s) => s.branchId));
}

/**
 * Reconstruct previously-completed branch results for `stageId` from the
 * journal's `stage.branch.finish` records (any prior attempt in this run,
 * across iterations — a stage that was mid-flight when the run was
 * interrupted leaves these records behind). The latest record per branch id
 * wins. Empty when resume is disabled or nothing was journaled yet.
 */
export function loadResumedBranches(
  loop: LoopContext,
  stageId: string,
): Map<string, FanoutBranchResult> {
  const resumed = new Map<string, FanoutBranchResult>();
  if (loop.runtime.noResume) return resumed;

  const lines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  for (const line of lines) {
    if (extractTopic(line) !== "stage.branch.finish") continue;
    if (extractField(line, "stage_id") !== stageId) continue;
    const branchId = extractField(line, "branch_id");
    if (!branchId) continue;
    const ok = extractField(line, "ok") === "true";
    const rawData = extractField(line, "data");
    let data: Record<string, unknown> | undefined;
    if (ok && rawData) {
      try {
        data = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        data = undefined;
      }
    }
    const error = extractField(line, "error");
    resumed.set(branchId, {
      branchId,
      ok: ok && data !== undefined,
      ...(data ? { data } : {}),
      ...(error ? { error } : {}),
    });
  }
  return resumed;
}

/**
 * Run a fan-out stage triggered by `emittedTopic`, reduce its branch results
 * to a routing decision, journal it, and continue the loop at the outcome
 * event. `stage.branch.finish` records (real launches only — resumed/
 * budget-skipped branches are not re-journaled) let a later attempt resume
 * this exact stage without relaunching branches that already finished.
 */
export async function finishStageIteration(
  loop: LoopContext,
  iter: IterationContext,
  stage: FanoutStage,
  emittedTopic: string,
  iterate: IterateFn,
): Promise<RunSummary> {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "stage.start",
    jsonField("stage_id", stage.id) +
      ", " +
      jsonField("trigger_topic", emittedTopic) +
      ", " +
      jsonField("branch_count", String(expandStageBranches(stage).length)),
  );

  const resumed = loadResumedBranches(loop, stage.id);
  const specs = expandStageBranches(stage);
  const toAdmit = specs.filter((s) => !resumed.has(s.branchId));
  const admitted = admitByBudget(loop, iter, toAdmit);

  const baseRunner = buildStageBranchRunner(loop, iter, stage.id);
  const runner: BranchRunner = async (spec) => {
    const cached = resumed.get(spec.branchId);
    if (cached) return cached;
    if (!admitted.has(spec.branchId)) {
      return {
        branchId: spec.branchId,
        ok: false,
        error: "budget: not admitted this wave",
      };
    }
    return baseRunner(spec);
  };

  const concurrency = Math.max(1, loop.stage?.concurrency || 1);
  const outcome = await runFanoutStage(stage, runner, concurrency);

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "stage.join",
    jsonField("stage_id", stage.id) +
      ", " +
      jsonField("event", outcome.event) +
      ", " +
      jsonField("passed", String(outcome.passed)) +
      ", " +
      jsonField("reason", outcome.reason) +
      ", " +
      jsonField("resumed_branches", String(resumed.size)),
  );

  appendHarnessEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    outcome.event,
    outcome.reason,
  );

  return iterate(loop, iter.iteration + 1);
}
