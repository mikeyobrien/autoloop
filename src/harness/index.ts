import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRunLines, readIfExists } from "./journal.js";
import { emit as emitCmd, resolveEmitJournalFile } from "./emit.js";
import { renderRunScratchpadFull } from "./scratchpad.js";
import { coordinationFromLines } from "./coordination.js";
import { collectMetricsRows, formatMetrics } from "./metrics.js";
import type { LoopContext, RunOptions, RunSummary } from "./types.js";
import {
  loadParallelBranchLaunch,
  parallelBranchBackendOverride,
  writeParallelBranchSummary,
  renderBranchResult,
  seedBranchContext,
  branchStopReason,
  appendLoopStart,
} from "./parallel.js";
import {
  printSummary,
  log,
  printProjectedMarkdown,
  printProjectedText,
} from "./display.js";
import {
  ensureLayout,
  installRuntimeTools,
  iterationFieldForRun,
  ensureRenderRunId,
  emptyFallback,
  buildLoopContext,
  reloadLoop,
  applyRuntimeModeOverrides,
  initStore,
} from "./config-helpers.js";
import { maybeRunMetareview } from "./metareview.js";
import { runIteration } from "./iteration.js";
import { stopMaxIterations } from "./stop.js";
import { registryStart } from "../registry/harness.js";
import { updateStatus as updateWorktreeStatus, readMeta } from "../worktree/meta.js";
import { mergeWorktree } from "../worktree/merge.js";
import { cleanWorktrees } from "../worktree/clean.js";
import * as config from "../config.js";

export type { LoopContext, RunOptions, RunSummary };

export function run(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): RunSummary {
  let loop = buildLoopContext(projectDir, promptOverride, selfCommand, runOptions);
  loop = initStore(loop);
  ensureLayout(loop.paths.stateDir);
  installRuntimeTools(loop);
  appendLoopStart(loop);
  registryStart(loop);
  log(loop, "info", `loop start run_id=${loop.runtime.runId} max_iterations=${loop.limits.maxIterations}`);
  const summary = iterate(loop, 1);

  // Post-run worktree lifecycle: status update, automerge, cleanup
  if (loop.runtime.isolationMode === "worktree" && loop.paths.worktreeMetaDir) {
    const succeeded = summary.stopReason === "completed";
    const wtStatus = succeeded ? "completed" : "failed";
    try { updateWorktreeStatus(loop.paths.worktreeMetaDir, wtStatus); } catch { /* meta update is best-effort */ }

    const keepWorktree = runOptions.keepWorktree ?? false;
    const automerge = runOptions.automerge ?? false;
    const cfg = config.loadProject(loop.paths.mainProjectDir);
    const cleanupPolicy = config.get(cfg, "worktree.cleanup", "on_success");

    // Automerge if requested and run succeeded
    if (automerge && succeeded && !keepWorktree) {
      const meta = readMeta(loop.paths.worktreeMetaDir);
      if (meta) {
        const strategy = (meta.merge_strategy || "squash") as "squash" | "merge" | "rebase";
        try {
          mergeWorktree({
            mainProjectDir: loop.paths.mainProjectDir,
            metaDir: loop.paths.worktreeMetaDir,
            strategy,
          });
          log(loop, "info", `worktree merged (${strategy}) for run ${loop.runtime.runId}`);
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
  return summary;
}

export { emitCmd as emit };

export function renderScratchpadFormat(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  printProjectedMarkdown(
    emptyFallback(renderRunScratchpadFull(readRunLines(journalFile, runId))),
    format,
  );
}

export function renderPromptFormat(
  projectDir: string,
  iteration: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
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
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const output = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.finish",
    "output",
  );
  console.log(output || `missing output projection for iteration ${iteration}`);
}

export function renderJournal(projectDir: string): void {
  console.log(readIfExists(resolveEmitJournalFile(projectDir)));
}

export function renderCoordinationFormat(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const lines = readRunLines(journalFile, runId);
  printProjectedMarkdown(emptyFallback(coordinationFromLines(lines)), format);
}

export function renderMetrics(
  projectDir: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
  const runId = ensureRenderRunId(journalFile);
  const lines = readRunLines(journalFile, runId);
  const rows = collectMetricsRows(lines);
  printProjectedText(formatMetrics(rows, format), format);
}

export function renderMetricsForRun(
  projectDir: string,
  runId: string,
  format: string,
): void {
  const journalFile = resolveEmitJournalFile(projectDir);
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
  const stopReason = branchStopReason(summary.stopReason, elapsedMs, seeded.parallel.branchTimeoutMs);

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

function iterate(loop: LoopContext, iteration: number): RunSummary {
  const liveLoop = reloadLoop(loop);
  installRuntimeTools(liveLoop);
  const reviewed = maybeRunMetareview(liveLoop, iteration);

  if (iteration > reviewed.limits.maxIterations) {
    return stopMaxIterations(reviewed, iteration);
  }
  return runIteration(reviewed, iteration, iterate);
}

