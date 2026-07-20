import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import {
  appendEvent,
  extractIteration,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { updateStatus as updateWorktreeStatus } from "@mobrienv/autoloop-core/worktree";
import {
  ensureLayout,
  initStore,
  installRuntimeTools,
  reloadLoop,
} from "./config-helpers.js";
import { publishCapabilities } from "./control/dispatch.js";
import { log } from "./display.js";
import { buildControlAdapter, driveLoop } from "./index.js";
import {
  findDanglingProvisional,
  resolveOrphanedProvisional,
} from "./provisional.js";
import { registryStart } from "./registry-bridge.js";
import { completeLoop } from "./stop.js";
import {
  clearResumeRequest,
  clearSuspendState,
  readSuspendState,
} from "./suspend-state.js";
import type {
  LoopContext,
  RunOptions,
  RunSummary,
  StopReason,
} from "./types.js";

export interface ResumeOptions {
  /** Additional iterations to grant beyond the resume point. */
  addIterations?: number;
  /**
   * Command that re-invokes the running CLI (same contract as run's
   * selfCommand). Required for the regenerated run-dir tool wrappers: an
   * empty value produced `if  "$@"` wrapper scripts after resume, so every
   * post-resume emit failed with `command not found`.
   */
  selfCommand?: string;
  /** Backend override (parsed `-b` spec), applied via reloadLoop. */
  backendOverride?: Record<string, unknown>;
  /** Log level override (e.g. "debug" for -v). */
  logLevel?: string | null;
  /**
   * Main repo state dir holding the registry the record was read from. Used
   * to anchor registryFile and worktree cleanup. When omitted it is derived
   * from the record (project_dir + state dir name).
   */
  baseStateDir?: string;
  /** Abort signal (CLI owns process signal handling). */
  signal?: AbortSignal;
  /** Structured-event listener. */
  onEvent?: RunOptions["onEvent"];
  /**
   * Force every fan-out stage branch to relaunch rather than reuse a
   * journaled `stage.branch.finish` record from an interrupted prior attempt.
   */
  noResume?: boolean;
}

export interface ResumeResult extends RunSummary {
  resumedFromIteration: number;
  newMaxIterations: number;
}

/**
 * Compute the iteration to resume at, given the terminating stop reason and
 * the last iteration recorded in the registry.
 *
 * - `max_iterations`: the registry iteration is the last *completed* one; the
 *   blocked iteration is the next one (registryIteration + 1).
 * - `backend_failed` / `backend_timeout`: the registry iteration is the one
 *   that failed mid-flight; retry it (registryIteration).
 * - `interrupted` / `stopped` (or anything else): scan the journal — if an
 *   `iteration.finish` exists for registryIteration it completed, so resume at
 *   the next one; otherwise it was in-flight, so retry it.
 */
export function determineResumeIteration(
  journalFile: string,
  runId: string,
  stopReason: string,
  registryIteration: number,
): number {
  if (stopReason === "max_iterations") {
    return registryIteration + 1;
  }
  if (stopReason === "backend_failed" || stopReason === "backend_timeout") {
    return registryIteration;
  }
  // interrupted / stopped / unknown: trust the journal.
  const lines = readRunLines(journalFile, runId);
  const finished = lines.some(
    (line) =>
      extractTopic(line) === "iteration.finish" &&
      extractIteration(line) === String(registryIteration),
  );
  return finished ? registryIteration + 1 : registryIteration;
}

/**
 * Build a LoopContext that reuses an existing run's identity (run_id, journal,
 * memory, working files, worktree) instead of generating fresh ones. Mirrors
 * `buildLoopContext` but skips run-id generation and worktree creation; the
 * one-time setup that resume needs (loading config, deriving paths, filling
 * topology/backend/limits) is delegated to `reloadLoop`.
 */
export function buildResumeContext(
  record: RunRecord,
  options: ResumeOptions = {},
): { loop: LoopContext; resumeIteration: number; addIterations: number } {
  const projectDir = record.project_dir;
  if (!projectDir) {
    throw new Error(`run ${record.run_id} has no project_dir; cannot resume`);
  }

  // findRunByPrefix reads the registry directly, so a resumable run always
  // carries the real state_dir that registryStart wrote (.autoloop/ for shared
  // and worktree modes, .autoloop/runs/<id>/ for run-scoped). Never guess it
  // from the journal path — for run-scoped runs the journal lives at the
  // top-level .autoloop/ while the state dir is .autoloop/runs/<id>/, so a
  // dirname() guess would point at the wrong directory.
  const stateDir = record.state_dir;
  if (!stateDir) {
    throw new Error(`run ${record.run_id} has no state_dir; cannot resume`);
  }
  const journalFile = record.journal_file;

  const isolationMode = record.isolation_mode || "run-scoped";
  const worktreeMode = isolationMode === "worktree";

  const workDir = worktreeMode
    ? record.worktree_path || record.work_dir
    : record.work_dir;

  // Recompute config-anchored paths exactly as buildLoopContext does, but
  // rooted in this run's existing state dir rather than a freshly-created one.
  const presetFile = record.preset_file || "";
  const cfg = presetFile
    ? config.loadProjectFromFile(presetFile, {
        presetName: record.preset || basename(projectDir),
        workDir,
      })
    : config.loadProject(projectDir, {
        presetName: record.preset || basename(projectDir),
        workDir,
      });
  const memoryFile = join(workDir, config.memoryPath(cfg));

  // baseStateDir is the main repo's state dir (registry + worktree metadata
  // live here). Prefer the caller-supplied path (the registry the record was
  // read from); fall back to deriving it. In worktree mode the per-run journal
  // lives under the worktree tree, so the main state dir is the project root's.
  const baseStateDir =
    options.baseStateDir ||
    (worktreeMode
      ? join(record.project_dir, config.stateDirRel(cfg))
      : stateDir);
  const registryFile = join(baseStateDir, "registry.jsonl");

  const backendOverride = options.backendOverride || {};
  const logLevel =
    options.logLevel || config.get(cfg, "core.log_level", "info");

  // A durable suspend (written by a `suspend`-policy hook) carries its own
  // recorded resume point — prefer it over the stop-reason heuristic, since
  // it reflects exactly where the hook engine intended to resume rather than
  // a best-effort guess from the journal.
  const suspendState = readSuspendState(stateDir);
  const resumeIteration = suspendState
    ? suspendState.resumeIteration
    : determineResumeIteration(
        journalFile,
        record.run_id,
        record.stop_reason,
        record.iteration,
      );

  // Budget is additive from the resume point. Default add-iterations to the
  // run's original max_iterations (so a max_iterations stop, by default, grants
  // another full run's worth of budget beyond what was completed).
  const addIterations =
    options.addIterations && options.addIterations > 0
      ? options.addIterations
      : record.max_iterations ||
        config.getInt(cfg, "event_loop.max_iterations", 3);
  const newMaxIterations = resumeIteration - 1 + addIterations;

  // The budget must survive reloadLoop (called at the start of every
  // iteration), which re-reads event_loop.max_iterations from config. Layer it
  // in as a run config override so each reload sees the additive budget rather
  // than the static config value.
  const configOverride = config.put(
    {},
    "event_loop.max_iterations",
    String(newMaxIterations),
  );

  const seed = {
    paths: {
      projectDir,
      workDir,
      stateDir,
      journalFile,
      memoryFile,
      runMemoryFile: join(stateDir, "memory.jsonl"),
      tasksFile: join(stateDir, "tasks.jsonl"),
      registryFile,
      toolPath: join(stateDir, "autoloops"),
      piAdapterPath: join(stateDir, "pi-adapter"),
      baseStateDir,
      mainProjectDir: projectDir,
      worktreeBranch: worktreeMode ? record.worktree_name : "",
      worktreePath: worktreeMode ? record.worktree_path : "",
      worktreeMetaDir: worktreeMode
        ? join(baseStateDir, "worktrees", record.run_id)
        : "",
      configWorkDir: workDir,
    },
    runtime: {
      runId: record.run_id,
      selfCommand: options.selfCommand ?? "",
      promptOverride: null,
      backendOverride,
      configOverride,
      logLevel,
      branchMode: false,
      isolationMode,
      noResume: options.noResume ?? false,
    },
    launch: {
      preset: record.preset || basename(projectDir),
      trigger: record.trigger || "cli",
      createdAt: record.created_at || new Date().toISOString(),
      parentRunId: record.parent_run_id || "",
      presetFile,
    },
    profiles: {
      active: [] as string[],
      fragments: new Map<string, string>(),
      warnings: [] as string[],
    },
    store: {},
  } as unknown as LoopContext;

  let loop = reloadLoop(seed);
  // Override the iteration budget: reloadLoop reads it fresh from config; resume
  // needs the additive budget from the resume point.
  loop = {
    ...loop,
    limits: { ...loop.limits, maxIterations: newMaxIterations },
  };

  return { loop, resumeIteration, addIterations };
}

/**
 * Resume a terminated run from where it left off. Validation (status, pid
 * liveness, missing files) is the caller's responsibility (see the CLI
 * command); this entry assumes the record is resumable and drives the same
 * iteration loop `run()` uses.
 */
export async function resume(
  record: RunRecord,
  options: ResumeOptions = {},
): Promise<ResumeResult> {
  const {
    loop: built,
    resumeIteration,
    addIterations,
  } = buildResumeContext(record, options);

  let loop = built;
  loop.onEvent = options.onEvent;
  loop = initStore(loop);
  ensureLayout(loop.paths.stateDir);
  installRuntimeTools(loop);

  // Append the resume marker before any iteration so the scratchpad and derive
  // path see it. It's a system topic — routing ignores it.
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.resume",
    jsonField("resumed_from_iteration", String(resumeIteration)) +
      ", " +
      jsonField("previous_stop_reason", record.stop_reason || "") +
      ", " +
      jsonField("add_iterations", String(addIterations)) +
      ", " +
      jsonField("new_max_iterations", String(loop.limits.maxIterations)),
  );

  // Registry: append a fresh record (status running, pid = this process). The
  // registry is last-write-wins per run_id, so this transitions the run back to
  // running exactly as the normal start path does.
  registryStart(loop);

  // Worktree mode: flip meta status back to running so the run isn't stuck as
  // "failed" if it crashed mid-flight.
  if (loop.paths.worktreeMetaDir && existsSync(loop.paths.worktreeMetaDir)) {
    try {
      updateWorktreeStatus(loop.paths.worktreeMetaDir, "running");
    } catch {
      /* best-effort */
    }
  }

  loop.controlAdapter = buildControlAdapter(loop);
  if (loop.controlAdapter) {
    publishCapabilities(loop.paths.stateDir, loop.controlAdapter);
  }

  // Clear durable suspend markers now that we're re-entering the loop at the
  // recorded resume point — a stale suspend-state.json would otherwise make
  // the next `run()` (or this resume, if invoked again) refuse to start.
  clearSuspendState(loop.paths.stateDir);
  clearResumeRequest(loop.paths.stateDir);

  const dangling = findDanglingProvisional(
    loop.paths.journalFile,
    loop.runtime.runId,
  );
  if (dangling) {
    const state = resolveOrphanedProvisional(loop, dangling, {
      registryIteration: record.iteration,
    });
    if (state === "accepted") {
      const summary = completeLoop(
        loop,
        dangling.iteration,
        dangling.reason as StopReason,
      );
      return {
        ...summary,
        resumedFromIteration: resumeIteration,
        newMaxIterations: loop.limits.maxIterations,
      };
    }
  }

  log(
    loop,
    "info",
    `resume run_id=${loop.runtime.runId} from_iteration=${resumeIteration} new_max_iterations=${loop.limits.maxIterations} (was: ${record.stop_reason || "unknown"})`,
  );

  const runOptions: RunOptions = {
    workDir: loop.paths.workDir,
    backendOverride: options.backendOverride,
    logLevel: options.logLevel,
    signal: options.signal,
    onEvent: options.onEvent,
  };

  const summary = await driveLoop(loop, runOptions, resumeIteration);
  return {
    ...summary,
    resumedFromIteration: resumeIteration,
    newMaxIterations: loop.limits.maxIterations,
  };
}
