import {
  decodeEvent,
  normalizeBackendLabel,
  splitCsv,
} from "@mobrienv/autoloop-core";
import type { RegistryStatus, RunRecord } from "./types.js";

/**
 * Derive run records from raw journal lines.
 * Each `loop.start` creates a new record; subsequent events update it.
 * Returns one record per run_id, reflecting the final known state.
 */
export function deriveRunRecords(lines: string[]): RunRecord[] {
  const runs = new Map<string, RunRecord>();

  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event) continue;

    const runId = event.run;
    if (!runId) continue;

    const topic = String(event.topic);

    if (topic === "loop.start" && event.shape === "fields") {
      const f = event.fields;
      runs.set(runId, {
        run_id: runId,
        status: "running",
        preset: f.preset ?? "",
        objective: f.objective ?? "",
        trigger: f.trigger ?? "",
        project_dir: f.project_dir ?? "",
        work_dir: f.work_dir ?? "",
        state_dir: "",
        journal_file: "",
        parent_run_id: f.parent_run_id ?? "",
        backend: normalizeBackendLabel(f.backend ?? ""),
        backend_args: f.backend_args ? splitCsv(f.backend_args) : [],
        created_at: f.created_at ?? "",
        updated_at: f.created_at ?? "",
        iteration: 0,
        max_iterations: Number(f.max_iterations) || 0,
        stop_reason: "",
        latest_event: topic,
        isolation_mode: f.isolation_mode ?? "run-scoped",
        worktree_name: f.worktree_name ?? "",
        worktree_path: f.worktree_path ?? "",
      });
      continue;
    }

    const record = runs.get(runId);
    if (!record) continue;

    if (topic === "iteration.finish") {
      const iter = event.iteration
        ? parseInt(event.iteration, 10)
        : record.iteration;
      record.iteration = Number.isNaN(iter) ? record.iteration : iter;
      record.updated_at = record.created_at;
      record.latest_event = topic;
      continue;
    }

    if (topic === "loop.resume") {
      // A terminated run is being continued. Flip it back to running and clear
      // the prior stop reason; subsequent iteration.finish / loop.* events
      // update iteration and final status as usual. The resume point is the
      // iteration the loop re-enters at, so the next completed iteration is
      // resumed_from_iteration - 1 + 1 = resumed_from_iteration.
      record.status = "running";
      record.stop_reason = "";
      record.updated_at = record.created_at;
      record.latest_event = topic;
      const resumedFrom = fieldValue(event, "resumed_from_iteration");
      const newMax = Number(fieldValue(event, "new_max_iterations"));
      if (resumedFrom) {
        const iter = parseInt(resumedFrom, 10);
        if (!Number.isNaN(iter)) record.iteration = iter - 1;
      }
      if (!Number.isNaN(newMax) && newMax > 0) record.max_iterations = newMax;
      continue;
    }

    if (topic === "loop.complete") {
      record.status = "completed";
      record.stop_reason = fieldValue(event, "reason");
      record.updated_at = record.created_at;
      record.latest_event = topic;
      continue;
    }

    if (topic === "loop.stop") {
      record.status = stopReasonToStatus(fieldValue(event, "reason"));
      record.stop_reason = fieldValue(event, "reason");
      record.updated_at = record.created_at;
      record.latest_event = topic;
    }
  }

  return Array.from(runs.values());
}

function fieldValue(
  event: ReturnType<typeof decodeEvent>,
  key: string,
): string {
  if (!event) return "";
  if (event.shape === "fields") return event.fields[key] ?? "";
  return "";
}

export function stopReasonToStatus(reason: string): RegistryStatus {
  if (reason === "backend_failed") return "failed";
  if (reason === "backend_timeout") return "timed_out";
  // Auth/quota won't self-resolve on retry — surface as failures. Rate-limit
  // and transient outages are availability stops (retryable), not failures.
  if (reason === "auth_failed" || reason === "quota_exhausted") return "failed";
  return "stopped";
}
