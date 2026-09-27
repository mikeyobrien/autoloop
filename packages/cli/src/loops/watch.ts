import {
  readRunLines,
  resolveRunJournalPath,
} from "@mobrienv/autoloop-core/journal";
import { mergedFindRunByPrefix } from "@mobrienv/autoloop-core/registry/discover";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { policyForPreset } from "@mobrienv/autoloop-core/runs-health";
import { resolveColumns } from "@mobrienv/autoloop-core/terminal-width";
import {
  collectMetricsRows,
  type MetricsRow,
} from "@mobrienv/autoloop-harness/metrics";
import { renderRunDetail } from "./render.js";
import { renderLiveLine, renderStepLine } from "./timeline.js";

const DEFAULT_INTERVAL_MS = 2000;

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "timed_out",
  "stopped",
]);

type HealthState = "active" | "watching" | "stuck";

/**
 * Compute a health advisory string for a run, or null if the run is healthy.
 * Returns a message only when the run is in the watching or stuck band.
 */
export function healthAdvisory(
  r: RunRecord,
  nowMs: number = Date.now(),
): string | null {
  if (r.status !== "running") return null;
  if (!r.updated_at) return null;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return null;
  const elapsed = nowMs - updatedMs;
  const policy = policyForPreset(r.preset);
  if (elapsed > policy.stuckAfterMs) {
    const mins = Math.round(elapsed / 60000);
    return (
      "[watch] " +
      r.preset +
      ": no progress for " +
      mins +
      "m — likely stuck, investigate now"
    );
  }
  if (elapsed > policy.warningAfterMs) {
    const mins = Math.round(elapsed / 60000);
    return (
      "[watch] " +
      r.preset +
      ": no progress for " +
      mins +
      "m — investigate soon"
    );
  }
  return null;
}

function healthState(r: RunRecord, nowMs: number): HealthState {
  if (r.status !== "running" || !r.updated_at) return "active";
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return "active";
  const elapsed = nowMs - updatedMs;
  const policy = policyForPreset(r.preset);
  if (elapsed > policy.stuckAfterMs) return "stuck";
  if (elapsed > policy.warningAfterMs) return "watching";
  return "active";
}

/**
 * Watch a run as a per-step timeline. Each tick re-reads the run's journal,
 * prints every newly finished step once, and shows the running step as a
 * live line (rewritten in place on a TTY, printed on change otherwise).
 * The registry is still polled for status, health, and terminal detail.
 *
 * For already-terminal runs, prints the full timeline and the detail view
 * and returns immediately.
 */
export async function watchRun(
  stateDir: string,
  partial: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<void> {
  const initial = resolveRun(stateDir, partial);
  if (typeof initial === "string") {
    console.log(initial);
    return;
  }

  const journalFile =
    initial.journal_file ||
    resolveRunJournalPath(stateDir, initial.run_id) ||
    "";
  const tty = process.stdout.isTTY === true;
  const width = (): number => resolveColumns(process.stdout, process.env, 100);
  const printed = new Set<string>();
  let liveShown = false;
  let lastLiveKey = "";

  const clearLive = (): void => {
    if (!liveShown) return;
    process.stdout.write("\r\x1b[2K");
    liveShown = false;
  };
  const say = (line: string): void => {
    clearLive();
    console.log(line);
  };
  const printFinishedSteps = (): MetricsRow | undefined => {
    const rows = journalFile
      ? collectMetricsRows(readRunLines(journalFile, initial.run_id))
      : [];
    for (const [i, row] of rows.entries()) {
      const key = `${i}:${row.iteration}`;
      if (!row.finished || printed.has(key)) continue;
      printed.add(key);
      say(renderStepLine(row, width()));
    }
    const last = rows[rows.length - 1];
    return last && !last.finished ? last : undefined;
  };
  const showLive = (row: MetricsRow | undefined): void => {
    if (!row) {
      clearLive();
      return;
    }
    const key = `${row.iteration}|${row.role}|${row.model}|${row.backendKind}`;
    if (tty) {
      process.stdout.write(
        `\r\x1b[2K${renderLiveLine(row, Date.now(), width())}`,
      );
      liveShown = true;
    } else if (key !== lastLiveKey) {
      console.log(renderLiveLine(row, Date.now(), width()));
    }
    lastLiveKey = key;
  };

  if (isTerminal(initial)) {
    printFinishedSteps();
    console.log(`[watch] Run already ${initial.status}.`);
    console.log(renderRunDetail(initial));
    return;
  }

  console.log(
    "[watch] Watching " +
      initial.run_id +
      " (" +
      initial.preset +
      ", poll every " +
      intervalMs / 1000 +
      "s)",
  );
  showLive(printFinishedSteps());

  let prevHealth = healthState(initial, Date.now());

  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearInterval(timer);
      process.off("SIGINT", onSigint);
      resolve();
    };
    const onSigint = (): void => {
      say("\n[watch] Interrupted.");
      finish();
    };
    process.on("SIGINT", onSigint);

    const timer = setInterval(() => {
      const current = resolveRun(stateDir, initial.run_id);
      if (typeof current === "string") {
        // Run disappeared from registry — unusual but handle gracefully
        say(`[watch] ${current}`);
        finish();
        return;
      }

      const running = printFinishedSteps();

      // Print advisory on health state transition
      const nowMs = Date.now();
      const currentHealth = healthState(current, nowMs);
      if (currentHealth !== prevHealth && currentHealth !== "active") {
        const advisory = healthAdvisory(current, nowMs);
        if (advisory) say(advisory);
      }
      prevHealth = currentHealth;

      if (isTerminal(current)) {
        say("");
        say(`[watch] Run ${current.status}.`);
        say(renderRunDetail(current));
        finish();
        return;
      }
      showLive(running);
    }, intervalMs);
  });
}

function resolveRun(stateDir: string, partial: string): RunRecord | string {
  const result = mergedFindRunByPrefix(stateDir, partial);
  if (result === undefined) {
    return `No run matching '${partial}'.`;
  }
  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => `  ${r.run_id}`).join("\n");
    return `Ambiguous run ID '${partial}'. Matches:\n${ids}`;
  }
  return result;
}

function isTerminal(r: RunRecord): boolean {
  return TERMINAL_STATUSES.has(r.status);
}
