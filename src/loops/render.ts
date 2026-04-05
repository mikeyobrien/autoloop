import type { RunRecord } from "../registry/types.js";

/**
 * Render a concise one-line summary for a run record.
 * Format: <short-id>  <status>  <preset>  iter:<N>  <latest_event>  <updated_at>
 */
export function renderRunLine(r: RunRecord): string {
  const shortId = shortRunId(r.run_id);
  const parts = [
    shortId.padEnd(24),
    r.status.padEnd(10),
    r.preset.padEnd(14),
    ("iter:" + r.iteration).padEnd(8),
    r.latest_event.padEnd(18),
    formatTime(r.created_at).padEnd(18),
    formatTime(r.updated_at),
  ];
  return parts.join("  ");
}

/**
 * Render a multi-line detail view for a single run.
 */
export function renderRunDetail(r: RunRecord): string {
  const lines: string[] = [
    field("Run", r.run_id),
    field("Status", r.status),
    field("Preset", r.preset),
    field("Objective", truncate(r.objective, 120)),
    field("Trigger", r.trigger),
    field("Backend", r.backend),
    field("Args", r.backend_args?.length ? r.backend_args.join(" ") : "(none)"),
    field("Iteration", String(r.iteration)),
    field("Latest", r.latest_event),
  ];
  if (r.stop_reason) lines.push(field("Stop", r.stop_reason));
  lines.push(field("Created", r.created_at));
  lines.push(field("Updated", r.updated_at));
  lines.push(field("Work dir", r.work_dir));
  lines.push(field("State dir", r.state_dir));
  if (r.parent_run_id) lines.push(field("Parent", r.parent_run_id));
  return lines.join("\n");
}

/**
 * Render artifact paths for a run.
 */
export function renderArtifacts(r: RunRecord, registryPath: string): string {
  const lines: string[] = [
    field("Journal", r.journal_file),
    field("Registry", registryPath),
    field("State dir", r.state_dir),
    field("Work dir", r.work_dir),
  ];
  return lines.join("\n");
}

/**
 * Render a header line for the list view.
 */
export function renderListHeader(): string {
  const parts = [
    "RUN ID".padEnd(24),
    "STATUS".padEnd(10),
    "PRESET".padEnd(14),
    "ITER".padEnd(8),
    "LATEST EVENT".padEnd(18),
    "STARTED".padEnd(18),
    "UPDATED",
  ];
  return parts.join("  ");
}

function field(label: string, value: string): string {
  return (label + ":").padEnd(12) + value;
}

function shortRunId(id: string): string {
  // run-abc12345-xyz0 → keep full id but it's already short enough
  // If run IDs are long, truncate to 16 chars
  if (id.length <= 24) return id;
  return id.slice(0, 22) + "..";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export function formatTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
