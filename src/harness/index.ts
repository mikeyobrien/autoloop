import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcpClientOptions } from "../backend/acp-client.js";
import {
  initKiroSession,
  signalInterrupt,
  terminateKiroSession,
} from "../backend/kiro-bridge.js";
import * as config from "../config.js";
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
  emptyFallback,
  ensureLayout,
  ensureRenderRunId,
  initStore,
  installRuntimeTools,
  iterationFieldForRun,
  reloadLoop,
  resolveJournalFileForRun,
} from "./config-helpers.js";
import { coordinationFromLines } from "./coordination.js";
import {
  log,
  printProjectedMarkdown,
  printProjectedText,
  printSummary,
} from "./display.js";
import { emit as emitCmd, resolveEmitJournalFile } from "./emit.js";
import { runIteration } from "./iteration.js";
import {
  readAllJournals,
  readIfExists,
  readRunJournal,
  readRunLines,
} from "./journal.js";
import { maybeRunMetareview } from "./metareview.js";
import { collectMetricsRows, formatMetrics } from "./metrics.js";
import {
  appendLoopStart,
  branchStopReason,
  loadParallelBranchLaunch,
  parallelBranchBackendOverride,
  renderBranchResult,
  seedBranchContext,
  writeParallelBranchSummary,
} from "./parallel.js";
import { renderRunScratchpadFull } from "./scratchpad.js";
import { stopMaxIterations } from "./stop.js";
import type { LoopContext, RunOptions, RunSummary } from "./types.js";

export type { LoopContext, RunOptions, RunSummary };

export function run(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): RunSummary {
  let loop = buildLoopContext(
    projectDir,
    promptOverride,
    selfCommand,
    runOptions,
  );
  loop = initStore(loop);
  ensureLayout(loop.paths.stateDir);
  installRuntimeTools(loop);
  appendLoopStart(loop);
  registryStart(loop);

  // Track current iteration for signal handler (must be mutable)
  let currentIteration = 0;
  let signalHandled = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (signalHandled) return;
    signalHandled = true;
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
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.kill(process.pid, signal);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

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
    currentIteration = iter;
    return iterateWith(ctx, iter, trackedIterate);
  };
  try {
    summary = trackedIterate(loop, 1);
  } finally {
    if (loop.kiroSession) {
      terminateKiroSession(loop.kiroSession);
    }
  }

  // Clean up signal handlers on normal exit
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

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
            mainProjectDir: loop.paths.mainProjectDir,
            metaDir: loop.paths.worktreeMetaDir,
            strategy,
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
            mainProjectDir: loop.paths.mainProjectDir,
            mainStateDir: loop.paths.baseStateDir,
            runId: loop.runtime.runId,
            force: cleanupPolicy === "always",
          });
          log(loop, "info", `worktree cleaned for run ${loop.runtime.runId}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(loop, "warn", `worktree cleanup failed: ${msg}`);
        }
      }
    }
  }

  printSummary(summary, loop);
  return { ...summary, runId: loop.runtime.runId };
}

export { emitCmd as emit };

export function renderScratchpadFormat(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  printProjectedMarkdown(
    emptyFallback(renderRunScratchpadFull(readRunLines(journalFile, runId))),
    format,
  );
}

export function renderPromptFormat(
  projectDir: string,
  iteration: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const prompt = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.start",
    "prompt",
  );
  if (!prompt) {
    console.log(`missing prompt projection for iteration ${iteration}`);
    return;
  }
  printProjectedMarkdown(prompt, format);
}

export function renderOutput(
  projectDir: string,
  iteration: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const output = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.finish",
    "output",
  );
  console.log(output || `missing output projection for iteration ${iteration}`);
}

export function renderJournal(projectDir: string, runId?: string): void {
  if (runId) {
    const stateDir = config.stateDirPath(projectDir);
    const lines = readRunJournal(stateDir, runId);
    console.log(lines.join("\n"));
    return;
  }
  console.log(readIfExists(resolveEmitJournalFile(projectDir)));
}

export function renderAllJournals(projectDir: string): void {
  const stateDir = config.stateDirPath(projectDir);
  const lines = readAllJournals(stateDir);
  if (lines.length > 0) {
    console.log(lines.join("\n"));
  } else {
    renderJournal(projectDir);
  }
}

export function renderCoordinationFormat(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const lines = readRunLines(journalFile, runId);
  printProjectedMarkdown(emptyFallback(coordinationFromLines(lines)), format);
}

export function renderMetrics(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const lines = readRunLines(journalFile, runId);
  const rows = collectMetricsRows(lines);
  printProjectedText(formatMetrics(rows, format), format);
}

export function runParallelBranchCli(
  projectDir: string,
  branchDir: string,
  selfCommand: string,
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

function resolveJournalAndRun(
  projectDir: string,
  runIdOverride?: string,
): { journalFile: string; runId: string } {
  if (runIdOverride) {
    return resolveJournalFileForRun(projectDir, runIdOverride);
  }
  const journalFile = resolveEmitJournalFile(projectDir);
  return { journalFile, runId: ensureRenderRunId(journalFile) };
}

function iterateWith(
  loop: LoopContext,
  iteration: number,
  recurse: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const liveLoop = reloadLoop(loop);
  liveLoop.kiroSession = loop.kiroSession;
  installRuntimeTools(liveLoop);
  const reviewed = maybeRunMetareview(liveLoop, iteration);

  if (iteration > reviewed.limits.maxIterations) {
    return stopMaxIterations(reviewed, iteration);
  }
  return runIteration(reviewed, iteration, recurse);
}

function iterate(loop: LoopContext, iteration: number): RunSummary {
  return iterateWith(loop, iteration, iterate);
}
