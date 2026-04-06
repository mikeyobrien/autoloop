import { mergedFindRunByPrefix } from "../registry/discover.js";
import type { RunRecord } from "../registry/types.js";
import { policyForPreset } from "./policy.js";
import { renderRunDetail, renderRunLine, renderListHeader } from "./render.js";

const DEFAULT_INTERVAL_MS = 2000;

const TERMINAL_STATUSES = new Set(["completed", "failed", "timed_out", "stopped"]);

type HealthState = "active" | "watching" | "stuck";

/**
 * Compute a health advisory string for a run, or null if the run is healthy.
 * Returns a message only when the run is in the watching or stuck band.
 */
export function healthAdvisory(r: RunRecord, nowMs: number = Date.now()): string | null {
  if (r.status !== "running") return null;
  if (!r.updated_at) return null;
  const updatedMs = new Date(r.updated_at).getTime();
  if (Number.isNaN(updatedMs)) return null;
  const elapsed = nowMs - updatedMs;
  const policy = policyForPreset(r.preset);
  if (elapsed > policy.stuckAfterMs) {
    const mins = Math.round(elapsed / 60000);
    return "[watch] " + r.preset + ": no progress for " + mins + "m — likely stuck, investigate now";
  }
  if (elapsed > policy.warningAfterMs) {
    const mins = Math.round(elapsed / 60000);
    return "[watch] " + r.preset + ": no progress for " + mins + "m — investigate soon";
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
 * Watch a run by polling the registry. Prints compact progress lines when
 * state changes, then a full detail view when the run reaches a terminal
 * status.
 *
 * For already-terminal runs, prints the detail view and returns immediately.
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

  if (isTerminal(initial)) {
    console.log("[watch] Run already " + initial.status + ".");
    console.log(renderRunDetail(initial));
    return;
  }

  console.log("[watch] Watching " + initial.run_id + " (poll every " + (intervalMs / 1000) + "s)");
  console.log(renderListHeader());
  console.log(renderRunLine(initial));

  let prev = snapshot(initial);
  let prevHealth = healthState(initial, Date.now());

  return new Promise<void>((resolve) => {
    const onSigint = (): void => {
      console.log("\n[watch] Interrupted.");
      clearInterval(timer);
      resolve();
    };
    process.on("SIGINT", onSigint);

    const timer = setInterval(() => {
      const current = resolveRun(stateDir, initial.run_id);
      if (typeof current === "string") {
        // Run disappeared from registry — unusual but handle gracefully
        console.log("[watch] " + current);
        clearInterval(timer);
        process.off("SIGINT", onSigint);
        resolve();
        return;
      }

      const snap = snapshot(current);
      if (snap !== prev) {
        prev = snap;
        console.log(renderRunLine(current));
      }

      // Print advisory on health state transition
      const nowMs = Date.now();
      const currentHealth = healthState(current, nowMs);
      if (currentHealth !== prevHealth && currentHealth !== "active") {
        const advisory = healthAdvisory(current, nowMs);
        if (advisory) console.log(advisory);
      }
      prevHealth = currentHealth;

      if (isTerminal(current)) {
        console.log("");
        console.log("[watch] Run " + current.status + ".");
        console.log(renderRunDetail(current));
        clearInterval(timer);
        process.off("SIGINT", onSigint);
        resolve();
      }
    }, intervalMs);
  });
}

function resolveRun(stateDir: string, partial: string): RunRecord | string {
  const result = mergedFindRunByPrefix(stateDir, partial);
  if (result === undefined) {
    return "No run matching '" + partial + "'.";
  }
  if (Array.isArray(result)) {
    const ids = result.map((r: RunRecord) => "  " + r.run_id).join("\n");
    return "Ambiguous run ID '" + partial + "'. Matches:\n" + ids;
  }
  return result;
}

function isTerminal(r: RunRecord): boolean {
  return TERMINAL_STATUSES.has(r.status);
}

function snapshot(r: RunRecord): string {
  return r.iteration + "|" + r.latest_event + "|" + r.status + "|" + r.updated_at;
}
