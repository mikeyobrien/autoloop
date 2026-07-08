// Real per-branch executor for fan-out `[[stage]]` blocks.
//
// Reuses the EXISTING supervisor/`branch-run` spawn+poll machinery
// (`writeBranchLaunch`, `launchParallelBranches`, `joinParallelBranches` from
// `launch-branches.ts`) rather than a second bespoke spawner — a stage branch
// is launched, polled, and timed out exactly like a parallel-wave branch. The
// only stage-specific piece is mapping a `fanout.BranchSpec` (role + objective)
// onto a wave `BranchSpec` (routing/allowed events) and then mapping the
// finished branch's output onto a `fanout.BranchResult` (structured `data`).
//
// A branch's role prompt is a single-turn agent whose entire final response IS
// the structured artifact for the stage: it must respond with exactly one JSON
// object (the fields the stage's reducer needs). That response is parsed
// through the SAME JSON-object path the evidence gate uses
// (`parseJsonObjectPayload` in `emit.ts`), so "structured branch output" means
// one thing everywhere. A branch that times out, fails, or does not respond
// with a parseable JSON object degrades to a dead branch (`ok: false`) rather
// than corrupting a vote or dedup — `reduceStage`/`applySchema` already drop
// those.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import type { BranchResult as FanoutBranchResult } from "@mobrienv/autoloop-core/fanout";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type * as topology from "@mobrienv/autoloop-core/topology";
import { parseJsonObjectPayload } from "../emit.js";
import type {
  BranchRunner,
  BranchSpec as StageSpec,
} from "../fanout-runner.js";
import type { IterationContext } from "../prompt.js";
import type { LoopContext } from "../types.js";
import {
  joinParallelBranches,
  launchParallelBranches,
  writeBranchLaunch,
} from "./launch-branches.js";
import type { BranchSpec as WaveBranchSpec } from "./types.js";

/** Directory holding every branch's launch/summary files for one stage run. */
export function stageBranchesDir(loop: LoopContext, stageId: string): string {
  return join(loop.paths.stateDir, "stages", stageId, "branches");
}

/**
 * Build a `BranchRunner` (the type `runFanoutStage` expects) that launches
 * each stage branch as an isolated single-turn agent running the branch's
 * role prompt, then reduces its final response into fan-out `BranchResult`
 * data.
 */
export function buildStageBranchRunner(
  loop: LoopContext,
  iter: IterationContext,
  stageId: string,
): BranchRunner {
  const stageDir = stageBranchesDir(loop, stageId);
  mkdirSync(stageDir, { recursive: true });

  return async (spec: StageSpec): Promise<FanoutBranchResult> => {
    const branchDir = join(stageDir, spec.branchId);
    mkdirSync(branchDir, { recursive: true });

    const role = loop.topology.roles.find((r) => r.id === spec.role);
    const prompt = renderStageBranchPrompt(loop, spec, role);

    const waveSpec: WaveBranchSpec = {
      branchId: spec.branchId,
      waveId: stageId,
      objective: spec.objective,
      emittedTopic: stageId,
      routingEvent: spec.role,
      allowedRoles: role ? [role.id] : [],
      allowedEvents: role?.emits ?? [],
      prompt,
      branchDir,
      launchFile: join(branchDir, "launch.json"),
      summaryFile: join(branchDir, "summary.json"),
      stdoutFile: join(branchDir, "stdout.log"),
      stderrFile: join(branchDir, "stderr.log"),
      statusFile: join(branchDir, "status.txt"),
      pidFile: join(branchDir, "pid.txt"),
      supervisorFile: join(branchDir, "supervisor.sh"),
      launchMs: 0,
    };

    writeBranchLaunch(waveSpec, loop);
    appendStageBranchStart(loop, iter, stageId, spec);
    const [launched] = launchParallelBranches(loop, [waveSpec]);
    const [result] = joinParallelBranches(loop, iter, stageId, [launched]);

    const succeeded =
      result.stopReason === "max_iterations" ||
      result.stopReason === "completion_event" ||
      result.stopReason === "completion_promise";
    const data = parseJsonObjectPayload(result.output);

    const branchResult: FanoutBranchResult =
      succeeded && data
        ? { branchId: spec.branchId, ok: true, data }
        : {
            branchId: spec.branchId,
            ok: false,
            error: succeeded
              ? "branch did not respond with a parseable JSON object"
              : `branch ${result.stopReason}`,
          };

    appendStageBranchFinish(
      loop,
      iter,
      stageId,
      branchResult,
      result.elapsedMs,
    );
    return branchResult;
  };
}

function renderStageBranchPrompt(
  loop: LoopContext,
  spec: StageSpec,
  role: topology.Role | undefined,
): string {
  const rolePrompt = role?.prompt ?? "";
  return (
    `${rolePrompt}\n\n` +
    "Fan-out stage branch:\n" +
    `Stage: ${spec.stageId}\n` +
    `Branch: ${spec.branchId} (index ${spec.index})\n` +
    `Branch objective/lens: ${spec.objective}\n\n` +
    `Parent objective:\n${loop.objective}\n\n` +
    "Respond with EXACTLY ONE JSON object as your entire final message — no " +
    "prose before or after it. It must carry every field the stage's " +
    "reducer needs (vote/dedup/count fields as instructed by your role). A " +
    "response that is not a single parseable JSON object is treated as a " +
    "dead branch and dropped from the tally.\n"
  );
}

function appendStageBranchStart(
  loop: LoopContext,
  iter: IterationContext,
  stageId: string,
  spec: StageSpec,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "stage.branch.start",
    jsonField("stage_id", stageId) +
      ", " +
      jsonField("branch_id", spec.branchId) +
      ", " +
      jsonField("role", spec.role) +
      ", " +
      jsonField("objective", spec.objective),
  );
}

function appendStageBranchFinish(
  loop: LoopContext,
  iter: IterationContext,
  stageId: string,
  result: FanoutBranchResult,
  elapsedMs: number,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "stage.branch.finish",
    jsonField("stage_id", stageId) +
      ", " +
      jsonField("branch_id", result.branchId) +
      ", " +
      jsonField("ok", String(result.ok)) +
      ", " +
      jsonField("data", result.data ? JSON.stringify(result.data) : "") +
      ", " +
      jsonField("error", result.error ?? "") +
      ", " +
      jsonField("elapsed_ms", String(elapsedMs)),
  );
}
