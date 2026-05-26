import type { KanbanColumn, Task } from "../task_store.js";

export const COLUMN_LABEL: Record<KanbanColumn, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  human_review: "Human review",
  rework: "Rework",
  merging: "Merging",
  done: "Done",
  cancelled: "Cancelled",
  duplicate: "Duplicate",
};

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );

export function relTime(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export const STATE_GLYPH: Record<string, string> = {
  running: "▶",
  idle: "⏸",
  paused: "⏸",
  crashed: "⚠",
  detached: "○",
};

export const STATE_LABEL: Record<string, string> = {
  running: "running",
  idle: "idle",
  paused: "paused",
  crashed: "crashed",
  detached: "detached",
};

export function resolveColumn(t: Task): KanbanColumn {
  if ((t.column as string) === "todo") return "backlog";
  if (t.column) return t.column;
  if (t.status === "in_progress") return "in_progress";
  if (t.status === "closed") return "done";
  if (t.status === "failed") return "cancelled";
  return "backlog";
}
