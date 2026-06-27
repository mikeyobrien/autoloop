// Fan-out stage orchestrator.
//
// Expands a FanoutStage into its branch specs, runs them concurrency-bounded
// (run-wide semaphore via mapLimit), isolates per-branch failure to a dead
// branch, and reduces the results with reduceStage. The actual branch executor
// (`runBranch`) is INJECTED: the orchestration here is pure and deterministically
// testable, while the real executor — spawning a backend CLI subprocess per
// branch — is a single seam wired into the iteration loop separately.

import { mapLimit } from "@mobrienv/autoloop-core/concurrency";
import {
  type BranchResult,
  type FanoutStage,
  reduceStage,
  type StageOutcome,
} from "@mobrienv/autoloop-core/fanout";

/** One branch to run: which role/prompt, with which objective, at which index. */
export interface BranchSpec {
  branchId: string;
  stageId: string;
  /** The role this branch runs (for K-identical) or the distinct sub-role. */
  role: string;
  /** Per-branch objective/lens (distinct panels vary this). */
  objective: string;
  index: number;
}

/**
 * Expand a stage into branch specs. A K-identical panel (`role` + `branches`)
 * produces N copies of the same role; an N-distinct panel (`roles`) produces one
 * branch per sub-role. Distinct wins when both are set.
 */
export function expandStageBranches(stage: FanoutStage): BranchSpec[] {
  if (stage.roles.length > 0) {
    return stage.roles.map((role, index) => ({
      branchId: `${stage.id}.${index}`,
      stageId: stage.id,
      role,
      objective: role,
      index,
    }));
  }
  const n = Math.max(0, stage.branches);
  return Array.from({ length: n }, (_, index) => ({
    branchId: `${stage.id}.${index}`,
    stageId: stage.id,
    role: stage.role,
    objective: stage.role,
    index,
  }));
}

export type BranchRunner = (spec: BranchSpec) => Promise<BranchResult>;

/**
 * Run a fan-out stage: expand branches, execute up to `concurrency` at once,
 * convert a thrown/rejected branch into a dead branch (so one failure never
 * sinks the wave), then reduce to a routing decision. `reduceStage` applies the
 * branch schema, quorum, and vote/dedup.
 */
export async function runFanoutStage(
  stage: FanoutStage,
  runBranch: BranchRunner,
  concurrency: number,
): Promise<StageOutcome> {
  const specs = expandStageBranches(stage);
  const results = await mapLimit(specs, concurrency, async (spec) => {
    try {
      return await runBranch(spec);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { branchId: spec.branchId, ok: false, error: msg };
    }
  });
  return reduceStage(stage, results);
}
