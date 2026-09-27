import { truncateToWidth } from "@mobrienv/autoloop-core/terminal-width";
import type { MetricsRow } from "@mobrienv/autoloop-harness/metrics";

/**
 * One line for a finished step. Short fixed-width fields lead and the long
 * ones trail, so a narrow pane truncates the model before the numbers:
 * `#3    builder-opus    2m14s  $0.14   plan.ready → review.ready   claude-opus-5-5`
 */
export function renderStepLine(row: MetricsRow, width: number): string {
  const emitted = row.event === "none" ? "(no event)" : row.event;
  const cost = row.costUsd > 0 ? `$${row.costUsd.toFixed(2)}` : "";
  const flag =
    row.outcome === "failed" || row.outcome === "timeout"
      ? `${row.outcome} `
      : "";
  const transition = row.recentEvent
    ? `${row.recentEvent} → ${emitted}`
    : emitted;
  return truncateToWidth(
    [
      stepHead(row),
      formatDuration(Number(row.elapsedS) || 0).padStart(8),
      cost.padEnd(6),
      `${flag}${transition}`.padEnd(30),
      modelLabel(row),
    ]
      .join("  ")
      .trimEnd(),
    width,
  );
}

/** One line for the running step, e.g. `▶ #4  critic  0m42s  running  xai/grok-4.7`. */
export function renderLiveLine(
  row: MetricsRow,
  nowMs: number,
  width: number,
): string {
  const startedMs = Date.parse(row.startedAt);
  const elapsedS = Number.isNaN(startedMs)
    ? 0
    : Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  return truncateToWidth(
    [
      `▶ ${stepHead(row)}`,
      formatDuration(elapsedS).padStart(8),
      "".padEnd(6),
      "running".padEnd(30),
      modelLabel(row),
    ].join("  "),
    width,
  );
}

function stepHead(row: MetricsRow): string {
  return `#${row.iteration}`.padEnd(4) + "  " + (row.role || "-").padEnd(14);
}

function modelLabel(row: MetricsRow): string {
  return row.model || row.backendKind || "-";
}

export function formatDuration(totalS: number): string {
  const s = Math.floor(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${sec}s`;
  return `${m}m${sec}s`;
}
