import { normalizeBackendLabel } from "@mobrienv/autoloop-core";
import { stopReasonToStatus } from "@mobrienv/autoloop-core/registry/derive";
import { getRun } from "@mobrienv/autoloop-core/registry/read";
import type {
  RegistryStatus,
  RunRecord,
} from "@mobrienv/autoloop-core/registry/types";
import { appendRegistryEntry } from "@mobrienv/autoloop-core/registry/update";
import type { LoopContext } from "../harness/types.js";

function registryPath(loop: LoopContext): string {
  return loop.paths.registryFile;
}

function baseRecord(loop: LoopContext): RunRecord {
  return {
    run_id: loop.runtime.runId,
    status: "running",
    preset: loop.launch.preset,
    objective: loop.objective,
    trigger: loop.launch.trigger,
    project_dir: loop.paths.projectDir,
    work_dir: loop.paths.workDir,
    state_dir: loop.paths.stateDir,
    journal_file: loop.paths.journalFile,
    parent_run_id: loop.launch.parentRunId,
    backend: normalizeBackendLabel(loop.backend.command),
    backend_args: loop.backend.args,
    created_at: loop.launch.createdAt,
    updated_at: new Date().toISOString(),
    iteration: 0,
    max_iterations: loop.limits.maxIterations,
    stop_reason: "",
    latest_event: "loop.start",
    isolation_mode: loop.runtime.isolationMode ?? "run-scoped",
    worktree_name: loop.paths.worktreeBranch || "",
    worktree_path: loop.paths.worktreePath || "",
    pid: process.pid,
  };
}

export function registryStart(loop: LoopContext): void {
  appendRegistryEntry(registryPath(loop), baseRecord(loop));
}

export function registryProgress(loop: LoopContext, iteration: number): void {
  const path = registryPath(loop);
  const existing = getRun(path, loop.runtime.runId);
  const record: RunRecord = existing ? { ...existing } : baseRecord(loop);
  record.iteration = iteration;
  record.updated_at = new Date().toISOString();
  record.latest_event = "iteration.finish";
  appendRegistryEntry(path, record);
}

export function registryTerminal(
  loop: LoopContext,
  iteration: number,
  status: RegistryStatus,
  stopReason: string,
  latestEvent: string,
): void {
  const path = registryPath(loop);
  const existing = getRun(path, loop.runtime.runId);
  const record: RunRecord = existing ? { ...existing } : baseRecord(loop);
  record.status = status;
  record.iteration = iteration;
  record.stop_reason = stopReason;
  record.updated_at = new Date().toISOString();
  record.latest_event = latestEvent;
  appendRegistryEntry(path, record);
}

export function registryComplete(
  loop: LoopContext,
  iteration: number,
  reason: string,
): void {
  registryTerminal(loop, iteration, "completed", reason, "loop.complete");
}

export function registryStop(
  loop: LoopContext,
  iteration: number,
  reason: string,
): void {
  registryTerminal(
    loop,
    iteration,
    stopReasonToStatus(reason),
    reason,
    "loop.stop",
  );
}
