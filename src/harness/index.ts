import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as config from "@mobrienv/autoloop-core/config";
import { readIfExists } from "@mobrienv/autoloop-core/journal";
import type { AcpClientOptions } from "../backend/acp-client.js";
import {
  initKiroSession,
  signalInterrupt,
  terminateKiroSession,
} from "../backend/kiro-bridge.js";
import { registryStart, registryStop } from "../registry/harness.js";
import { cleanWorktrees } from "../worktree/clean.js";
import { mergeWorktree } from "../worktree/merge.js";
import {
  readMeta,
  updateStatus as updateWorktreeStatus,
} from "../worktree/meta.js";
import {
  applyRuntimeModeOverrides,
  buildLoopContext,
  ensureLayout,
  initStore,
  installRuntimeTools,
  iterationFieldForRun,
  reloadLoop,
} from "./config-helpers.js";
import { log } from "./display.js";
import { emit as emitCmd } from "./emit.js";
import { runIteration } from "./iteration.js";
import { maybeRunMetareview } from "./metareview.js";
import {
  appendLoopStart,
  branchStopReason,
  loadParallelBranchLaunch,
  parallelBranchBackendOverride,
  renderBranchResult,
  seedBranchContext,
  writeParallelBranchSummary,
} from "./parallel.js";
import { completeLoop, stopMaxIterations } from "./stop.js";
import type { LoopContext, RunOptions, RunSummary } from "./types.js";

export type { LoopContext, RunOptions, RunSummary };

export async function run(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): Promise<RunSummary> {
  let loop = buildLoopContext(
    projectDir,
    promptOverride,
    selfCommand,
    runOptions,
  );
  loop.onEvent = runOptions.onEvent;
  loop = initStore(loop);
  ensureLayout(loop.paths.stateDir);
  installRuntimeTools(loop);
  appendLoopStart(loop);
  registryStart(loop);

  // Track current iteration for abort handler (must be mutable)
  let currentIteration = 0;
  let aborted = false;

  const teardown = () => {
    if (aborted) return;
    aborted = true;
    signalInterrupt();
    try {
      if (loop.kiroSession) {
        terminateKiroSession(loop.kiroSession);
        loop.kiroSession = undefined;
      }
    } catch {
      /* best-effort */
    }
    try {
      registryStop(loop, currentIteration, "interrupted");
    } catch {
      /* best-effort */
    }
    // Update worktree meta so the run isn't stuck as "running"
    if (loop.paths.worktreeMetaDir) {
      try {
        updateWorktreeStatus(loop.paths.worktreeMetaDir, "failed");
      } catch {
        /* best-effort */
      }
    }
    // Remove active wave marker so future waves aren't blocked
    const waveMarker = join(loop.paths.stateDir, "waves", "active");
    if (existsSync(waveMarker)) {
      try {
        unlinkSync(waveMarker);
      } catch {
        /* best-effort */
      }
    }
  };

  // SDK-friendly cancellation: caller owns process signal handling and
  // passes an AbortSignal. The CLI entry (dispatchRun) installs SIGINT/
  // SIGTERM handlers that abort this controller. Without a signal the
  // harness simply runs to completion (no process.on handlers installed).
  const onAbort = () => teardown();
  runOptions.signal?.addEventListener("abort", onAbort);
  if (runOptions.signal?.aborted) teardown();

  log(
    loop,
    "info",
    `loop start run_id=${loop.runtime.runId} max_iterations=${loop.limits.maxIterations}`,
  );

  // Initialize kiro ACP session if backend is kiro
  if (loop.backend.kind === "kiro") {
    const acpOpts: AcpClientOptions = {
      command: loop.backend.command,
      args: loop.backend.args,
      cwd: loop.paths.workDir,
      trustAllTools: loop.store.kiro_trust_all_tools !== false,
      agentName: (loop.store.kiro_agent as string) || undefined,
      modelId: (loop.store.kiro_model as string) || undefined,
      verbose: loop.runtime.logLevel === "debug",
    };
    loop.kiroSession = initKiroSession(acpOpts);
  }

  let summary: RunSummary;
  const trackedIterate = (ctx: LoopContext, iter: number): RunSummary => {
    if (aborted)
      return {
        iterations: iter - 1,
        stopReason: "interrupted",
        runId: ctx.runtime.runId,
      };
    currentIteration = iter;
    ctx.onEvent?.({
      type: "iteration.start",
      iteration: iter,
      maxIterations: ctx.limits.maxIterations,
      runId: ctx.runtime.runId,
    });
    return iterateWith(ctx, iter, trackedIterate);
  };
  try {
    summary = trackedIterate(loop, 1);
  } finally {
    if (loop.kiroSession) {
      terminateKiroSession(loop.kiroSession);
    }
    runOptions.signal?.removeEventListener("abort", onAbort);
  }

  // Post-run worktree lifecycle: status update, automerge, cleanup
  if (loop.runtime.isolationMode === "worktree" && loop.paths.worktreeMetaDir) {
    const succeeded = summary.stopReason === "completed";
    const wtStatus = succeeded ? "completed" : "failed";
    try {
      updateWorktreeStatus(loop.paths.worktreeMetaDir, wtStatus);
    } catch {
      /* meta update is best-effort */
    }

    const keepWorktree = runOptions.keepWorktree ?? false;
    const automerge = runOptions.automerge ?? false;
    const cfg = config.loadProject(loop.paths.mainProjectDir);
    const cleanupPolicy = config.get(cfg, "worktree.cleanup", "on_success");

    // Automerge if requested and run succeeded.
    // Skip when trigger is "chain" — chain-mode defers merge to a dedicated automerge step.
    if (
      automerge &&
      succeeded &&
      !keepWorktree &&
      loop.launch.trigger !== "chain"
    ) {
      const meta = readMeta(loop.paths.worktreeMetaDir);
      if (meta) {
        const strategy = (meta.merge_strategy || "squash") as
          | "squash"
          | "merge"
          | "rebase";
        try {
          mergeWorktree({
            metaDir: loop.paths.worktreeMetaDir,
            strategy,
            workDir: loop.paths.workDir,
          });
          log(
            loop,
            "info",
            `worktree merged (${strategy}) for run ${loop.runtime.runId}`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(loop, "warn", `worktree merge failed: ${msg}`);
        }
      }
    }

    // Cleanup worktree based on policy (unless --keep-worktree)
    if (!keepWorktree) {
      const shouldClean =
        cleanupPolicy === "always" ||
        (cleanupPolicy === "on_success" && succeeded);
      if (shouldClean) {
        try {
          cleanWorktrees({
            mainStateDir: loop.paths.baseStateDir,
            runId: loop.runtime.runId,
            force: cleanupPolicy === "always",
            workDir: loop.paths.workDir,
          });
          log(loop, "info", `worktree cleaned for run ${loop.runtime.runId}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(loop, "warn", `worktree cleanup failed: ${msg}`);
        }
      }
    }
  }

  loop.onEvent?.({
    type: "summary",
    runId: loop.runtime.runId,
    iterations: summary.iterations,
    stopReason: summary.stopReason,
    journalFile: loop.paths.journalFile,
    memoryFile: loop.paths.memoryFile,
    reviewEvery: loop.review.every,
    toolPath: loop.paths.toolPath,
  });
  loop.onEvent?.({
    type: "loop.finish",
    iterations: summary.iterations,
    stopReason: summary.stopReason,
    runId: loop.runtime.runId,
  });
  return { ...summary, runId: loop.runtime.runId };
}

export { emitCmd as emit };

export function runParallelBranchCli(
  projectDir: string,
  branchDir: string,
  selfCommand: string,
  onEvent?: (event: import("./events.js").LoopEvent) => void,
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
    trigger: "branch",
  });
  branchLoop.onEvent = onEvent;
  branchLoop = initStore(branchLoop);
  branchLoop.runtime.branchMode = true;
  branchLoop = applyRuntimeModeOverrides(branchLoop);
  ensureLayout(branchLoop.paths.stateDir);
  installRuntimeTools(branchLoop);
  appendLoopStart(branchLoop);
  registryStart(branchLoop);

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
  const stopReason = branchStopReason(
    summary.stopReason,
    elapsedMs,
    seeded.parallel.branchTimeoutMs,
  );

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

function iterateWith(
  loop: LoopContext,
  iteration: number,
  recurse: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const liveLoop = reloadLoop(loop);
  liveLoop.kiroSession = loop.kiroSession;
  installRuntimeTools(liveLoop);
  const reviewed = maybeRunMetareview(liveLoop, iteration);
  const verdict = reviewed.lastVerdict;

  if (verdict) {
    if (verdict.verdict === "EXIT")
      return completeLoop(reviewed, iteration, "verdict_exit");
    if (verdict.verdict === "TAKEOVER")
      return completeLoop(reviewed, iteration, "verdict_takeover");
    if (verdict.verdict === "REDIRECT") {
      const redirectPath = join(reviewed.paths.stateDir, "redirect.md");
      const redirectContent = readIfExists(redirectPath);
      if (redirectContent) {
        reviewed.objective =
          "IMPORTANT: The metareviewer has redirected this task. Disregard your previous approach. New direction:\n" +
          redirectContent +
          "\n\n" +
          reviewed.objective;
      }
    }
  }

  if (iteration > reviewed.limits.maxIterations) {
    return stopMaxIterations(reviewed, iteration);
  }
  return runIteration(reviewed, iteration, recurse);
}

function iterate(loop: LoopContext, iteration: number): RunSummary {
  return iterateWith(loop, iteration, iterate);
}
