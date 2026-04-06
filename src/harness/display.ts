import { execSync } from "node:child_process";
import { listText, lineSep } from "../utils.js";
import type { LoopContext, RunSummary } from "./types.js";
import type { IterationContext } from "./prompt.js";

export function printSummary(summary: RunSummary, loop: LoopContext): void {
  const hint = stopReasonHint(summary.stopReason);
  const lines = [
    "autoloops summary",
    "===================",
    `run_id: ${loop.runtime.runId}`,
    `iterations: ${summary.iterations}`,
    `stop_reason: ${summary.stopReason}`,
    `journal: ${loop.paths.journalFile}`,
    `memory: ${loop.paths.memoryFile}`,
    `review_every: ${loop.review.every}`,
    `inspect scratchpad: ${loop.paths.toolPath} inspect scratchpad --format md`,
    ...hint,
  ];
  for (const l of lines) console.log(l);
}

function stopReasonHint(reason: string): string[] {
  switch (reason) {
    case "backend_failed":
      return ["Hint: check the backend output above; common causes: invalid API key, model not available, network error."];
    case "backend_timeout":
      return ["Hint: the backend did not respond in time. Try increasing timeout or check backend availability."];
    case "max_iterations":
      return ["Hint: loop reached the iteration limit without a completion event. Increase max_iterations or check if agents are stuck."];
    default:
      return [];
  }
}

function decorativeOutputEnabled(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function printIterationBanner(loop: LoopContext, iter: IterationContext): void {
  const roleLine = `role: ${listText(iter.allowedRoles)} │ event: ${iter.recentEvent} │ next: ${listText(iter.allowedEvents)}`;
  if (!decorativeOutputEnabled()) {
    console.log(`iteration ${iter.iteration}/${loop.limits.maxIterations}`);
    console.log(roleLine);
    if (iter.lastRejected) {
      console.log(`previous emit rejected: \`${iter.lastRejected}\` — rerouting`);
    }
    return;
  }
  const label = `━━━ iteration ${iter.iteration}/${loop.limits.maxIterations} `;
  const width = terminalWidth();
  const rule = label.padEnd(width, "━");
  console.log("");
  console.log(rule);
  console.log(roleLine);
  if (iter.lastRejected) {
    console.log(`↳ previous emit rejected: \`${iter.lastRejected}\` — rerouting`);
  }
  console.log("━".repeat(width));
}

export function printIterationFooter(iter: IterationContext, elapsedS: number): void {
  if (!decorativeOutputEnabled()) return;
  const elapsed = elapsedS >= 60
    ? `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`
    : `${elapsedS}s`;
  const label = `──── end iteration ${iter.iteration} (${elapsed}) `;
  console.log(label.padEnd(terminalWidth(), "─"));
  console.log("");
}

export function printProgressLine(data: {
  runId: string;
  iteration: number;
  recentEvent: string;
  allowedRoles: string[];
  emittedTopic?: string;
  outcome: string;
}): void {
  const parts = [
    "[progress]",
    `ts=${new Date().toISOString()}`,
    `run_id=${data.runId}`,
    `iter=${data.iteration}`,
    `role=${progressRoleLabel(data.allowedRoles)}`,
    `recent=${data.recentEvent || "(none)"}`,
  ];
  if (data.emittedTopic) parts.push(`emitted=${data.emittedTopic}`);
  parts.push(`outcome=${data.outcome}`);
  console.log(parts.join(" "));
}

function progressRoleLabel(roles: string[]): string {
  if (roles.length === 0) return "(none)";
  if (roles.length === 1) return roles[0];
  return roles.join(",");
}

export function printReviewBanner(iteration: number): void {
  if (!decorativeOutputEnabled()) {
    console.log(`review before iteration ${iteration}`);
    return;
  }
  const label = `━━━ review before iteration ${iteration} `;
  console.log("");
  console.log(label.padEnd(terminalWidth(), "━"));
}

export function printBackendOutputTail(output: string, maxLines: number = 200): void {
  const lines = output.split(lineSep());
  const tail = lines.slice(-maxLines);
  if (!tail.join("").trim()) return;
  const shown = Math.min(lines.length, maxLines);
  if (!decorativeOutputEnabled()) {
    console.log(`── backend stdout (last ${shown} of ${lines.length} lines) ──`);
    console.log(tail.join(lineSep()));
    return;
  }
  console.log(`── backend stdout (last ${shown} of ${lines.length} lines) ──`);
  console.log(tail.join(lineSep()));
  console.log("──────────────────────────────────────");
}

export function printFailureDiagnostic(output: string, stopReason: string): void {
  const lines = output.split(lineSep());
  const tail = lines.slice(-15).join(lineSep());
  if (!tail.trim()) return;
  const header = stopReason
    ? `── backend output (last 15 lines) — stopped: ${stopReason} ──`
    : "── backend output (last 15 lines) ──";
  console.log("");
  console.log(header);
  console.log(tail);
  console.log("──────────────────────────────────────");
}

export function terminalWidth(): number {
  const envWidth = parseInt(process.env["AUTOLOOP_WIDTH"] ?? "", 10);
  if (envWidth > 0) return envWidth;
  const cols = parseInt(process.env["COLUMNS"] ?? "", 10);
  if (cols > 0) return cols;
  try {
    const tputResult = execSync("tput cols 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();
    const w = parseInt(tputResult, 10);
    if (w > 0) return w;
  } catch { /* ignore */ }
  return 68;
}

export function lastNChars(text: string, n: number): string {
  return text.length > n ? text.slice(-n) : text;
}

export function log(loop: LoopContext, level: string, message: string): void {
  const ranks: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  const currentRank = ranks[loop.runtime.logLevel] ?? 1;
  const messageRank = ranks[level] ?? 1;
  if (messageRank >= currentRank) {
    process.stderr.write(`[autoloops] [${level}] ${message}\n`);
  }
}

export function printProjectedMarkdown(text: string, format: string): void {
  // In terminal mode, the original uses host_call(:io_render_markdown)
  // which is Tonic-specific. For TS, just output plain text.
  console.log(text);
}

export function printProjectedText(text: string, format: string): void {
  console.log(text);
}
