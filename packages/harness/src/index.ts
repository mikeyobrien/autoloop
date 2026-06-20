import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeBackendLabel } from "@mobrienv/autoloop-backends";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import { terminateAcpSession } from "@mobrienv/autoloop-backends/acp-client";
import {
  abortClaudeSdkTurn,
  steerClaudeSdkTurn,
  terminateClaudeSdkSession,
} from "@mobrienv/autoloop-backends/claude-sdk-client";
import {
  abortPiTurn,
  steerPiTurn,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";
import * as config from "@mobrienv/autoloop-core/config";
import { readIfExists, readRunLines } from "@mobrienv/autoloop-core/journal";
import {
  cleanWorktrees,
  mergeWorktree,
  readMeta,
  updateStatus as updateWorktreeStatus,
} from "@mobrienv/autoloop-core/worktree";
import {
  applyRuntimeModeOverrides,
  buildLoopContext,
  ensureLayout,
  initStore,
  installRuntimeTools,
  iterationFieldForRun,
  reloadLoop,
} from "./config-helpers.js";
import { acpControlAdapter } from "./control/acp-adapter.js";
import type { LiveControlAdapter } from "./control/adapter.js";
import { claudeSdkControlAdapter } from "./control/claude-sdk-adapter.js";
import {
  drainControlRequests,
  publishCapabilities,
} from "./control/dispatch.js";
import { piControlAdapter } from "./control/pi-adapter.js";
import { log } from "./display.js";
import { emit as emitCmd } from "./emit.js";
import { checkCostBudget, checkRuntimeBudget, detectStall } from "./guards.js";
import { runIteration } from "./iteration.js";
import { maybeRunMetareview } from "./metareview.js";
import { runFinishNotification } from "./notify.js";
import {
  appendLoopStart,
  branchStopReason,
  loadParallelBranchLaunch,
  parallelBranchBackendOverride,
  renderBranchResult,
  seedBranchContext,
  writeParallelBranchSummary,
} from "./parallel.js";
import { registryStart, registryStop } from "./registry-bridge.js";
import {
  completeLoop,
  stopCostBudget,
  stopMaxIterations,
  stopMaxRuntime,
  stopStalled,
} from "./stop.js";
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
  loop.controlAdapter = buildControlAdapter(loop);
  if (loop.controlAdapter) {
    publishCapabilities(loop.paths.stateDir, loop.controlAdapter);
  }

  // Track current iteration for abort handler (must be mutable)
  let currentIteration = 0;
  let aborted = false;

  const teardown = () => {
    if (aborted) return;
    aborted = true;
    // Fire-and-forget session termination — abort handlers must stay sync.
    // The finally block below awaits a final terminate as backstop.
    if (loop.acpSession.current) {
      const session = loop.acpSession.current;
      loop.acpSession.current = undefined;
      terminateAcpSession(session).catch(() => {
        /* best-effort */
      });
    }
    if (loop.piSession.current) {
      const session = loop.piSession.current;
      loop.piSession.current = undefined;
      terminatePiSession(session).catch(() => {
        /* best-effort */
      });
    }
    if (loop.claudeSdkSession.current) {
      const session = loop.claudeSdkSession.current;
      loop.claudeSdkSession.current = undefined;
      terminateClaudeSdkSession(session).catch(() => {
        /* best-effort */
      });
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

  const onSigusr1 = (): void => {
    if (!loop.controlAdapter) return;
    try {
      drainControlRequests(loop.paths.stateDir, loop.controlAdapter);
    } catch {
      /* best-effort */
    }
  };
  process.on("SIGUSR1", onSigusr1);

  log(
    loop,
    "info",
    `loop start run_id=${loop.runtime.runId} max_iterations=${loop.limits.maxIterations}`,
  );

  loop.onEvent?.({
    type: "loop.start",
    runId: loop.runtime.runId,
    prompt: loop.objective,
    workDir: loop.paths.workDir,
    projectDir: loop.paths.projectDir,
    preset: loop.launch.preset,
    backend: normalizeBackendLabel(loop.backend.command),
    maxIterations: loop.limits.maxIterations,
    completionEvent: loop.completion.event,
    completionPromise: loop.completion.promise,
  });

  let summary: RunSummary;
  const trackedIterate = async (
    ctx: LoopContext,
    iter: number,
  ): Promise<RunSummary> => {
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
    summary = await trackedIterate(loop, 1);
  } finally {
    if (loop.acpSession.current) {
      try {
        await terminateAcpSession(loop.acpSession.current);
      } catch {
        /* best-effort */
      }
      loop.acpSession.current = undefined;
    }
    if (loop.piSession.current) {
      try {
        await terminatePiSession(loop.piSession.current);
      } catch {
        /* best-effort */
      }
      loop.piSession.current = undefined;
    }
    if (loop.claudeSdkSession.current) {
      try {
        await terminateClaudeSdkSession(loop.claudeSdkSession.current);
      } catch {
        /* best-effort */
      }
      loop.claudeSdkSession.current = undefined;
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

  runFinishNotification({
    projectDir: loop.paths.mainProjectDir,
    journalFile: loop.paths.journalFile,
    runId: loop.runtime.runId,
    preset: loop.launch.preset,
    stopReason: summary.stopReason,
    iterations: summary.iterations,
  });

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

export async function runParallelBranchCli(
  projectDir: string,
  branchDir: string,
  selfCommand: string,
  onEvent?: (event: import("./events.js").LoopEvent) => void,
): Promise<void> {
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
  branchLoop.controlAdapter = buildControlAdapter(branchLoop);
  if (branchLoop.controlAdapter) {
    publishCapabilities(branchLoop.paths.stateDir, branchLoop.controlAdapter);
  }

  const seeded = seedBranchContext(branchLoop, routingEvent);
  const startMs = Date.now();
  let summary: RunSummary;
  try {
    summary = await iterate(seeded, 1);
  } finally {
    if (seeded.acpSession.current) {
      try {
        await terminateAcpSession(seeded.acpSession.current);
      } catch {
        /* best-effort */
      }
      seeded.acpSession.current = undefined;
    }
    if (seeded.piSession.current) {
      try {
        await terminatePiSession(seeded.piSession.current);
      } catch {
        /* best-effort */
      }
      seeded.piSession.current = undefined;
    }
    if (seeded.claudeSdkSession.current) {
      try {
        await terminateClaudeSdkSession(seeded.claudeSdkSession.current);
      } catch {
        /* best-effort */
      }
      seeded.claudeSdkSession.current = undefined;
    }
  }
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
  recurse: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
): Promise<RunSummary> {
  const liveLoop = reloadLoop(loop);
  liveLoop.controlAdapter = loop.controlAdapter;
  installRuntimeTools(liveLoop);
  return runReviewThenIterate(liveLoop, iteration, recurse);
}

async function runReviewThenIterate(
  liveLoop: LoopContext,
  iteration: number,
  recurse: (loop: LoopContext, iteration: number) => Promise<RunSummary>,
): Promise<RunSummary> {
  if (liveLoop.controlAdapter) {
    try {
      drainControlRequests(liveLoop.paths.stateDir, liveLoop.controlAdapter);
    } catch {
      /* control drain is best-effort; next pass will retry */
    }
  }
  const reviewed = await maybeRunMetareview(liveLoop, iteration);
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
  // Guard checks between iterations: both are journal-derived so they cover
  // every continue path (routed, rejected, plain) without in-memory state.
  if (iteration > 1) {
    const runLines = readRunLines(
      reviewed.paths.journalFile,
      reviewed.runtime.runId,
    );
    const stall = detectStall(runLines, reviewed.limits.stallIterations ?? 0);
    if (stall.stalled) {
      return stopStalled(reviewed, iteration - 1, stall.repeats);
    }
    const budget = checkCostBudget(runLines, reviewed.limits.maxCostUsd ?? 0);
    if (budget.exceeded) {
      return stopCostBudget(
        reviewed,
        iteration - 1,
        budget.costUsd,
        reviewed.limits.maxCostUsd ?? 0,
      );
    }
    const runtime = checkRuntimeBudget(
      runLines,
      reviewed.limits.maxRuntimeMs ?? 0,
    );
    if (runtime.exceeded) {
      return stopMaxRuntime(
        reviewed,
        iteration - 1,
        runtime.elapsedMs,
        reviewed.limits.maxRuntimeMs ?? 0,
      );
    }
  }
  return runIteration(reviewed, iteration, recurse);
}

function iterate(loop: LoopContext, iteration: number): Promise<RunSummary> {
  return iterateWith(loop, iteration, iterate);
}

function buildControlAdapter(
  loop: LoopContext,
): LiveControlAdapter | undefined {
  if (loop.backend.kind === "acp") {
    return acpControlAdapter(loop.runtime.runId, loop.backend.provider, {
      triggerInterrupt: () => {
        if (loop.acpSession.current?.process.pid) {
          try {
            process.kill(-loop.acpSession.current.process.pid, "SIGINT");
          } catch {
            /* best-effort */
          }
        }
      },
    });
  }
  if (loop.backend.kind === "pi") {
    return piControlAdapter(loop.runtime.runId, {
      triggerInterrupt: () => {
        if (loop.piSession.current) {
          abortPiTurn(loop.piSession.current);
        }
      },
      triggerSteer: (message) => {
        if (loop.piSession.current) {
          steerPiTurn(loop.piSession.current, message);
        }
      },
    });
  }
  if (loop.backend.kind === "claude-sdk") {
    return claudeSdkControlAdapter(loop.runtime.runId, {
      triggerInterrupt: () => {
        if (loop.claudeSdkSession.current) {
          abortClaudeSdkTurn(loop.claudeSdkSession.current);
        }
      },
      triggerSteer: (message) => {
        if (loop.claudeSdkSession.current) {
          steerClaudeSdkTurn(loop.claudeSdkSession.current, message);
        }
      },
    });
  }
  return undefined;
}
