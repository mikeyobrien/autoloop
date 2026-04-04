import { findRunByPrefix } from "../registry/read.js";
import type { RunRecord } from "../registry/types.js";
import { renderRunDetail, renderRunLine, renderListHeader } from "./render.js";

const DEFAULT_INTERVAL_MS = 2000;

const TERMINAL_STATUSES = new Set(["completed", "failed", "timed_out", "stopped"]);

/**
 * Watch a run by polling the registry. Prints compact progress lines when
 * state changes, then a full detail view when the run reaches a terminal
 * status.
 *
 * For already-terminal runs, prints the detail view and returns immediately.
 */
export async function watchRun(
  registryPath: string,
  partial: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<void> {
  const initial = resolveRun(registryPath, partial);
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

  return new Promise<void>((resolve) => {
    const onSigint = (): void => {
      console.log("\n[watch] Interrupted.");
      clearInterval(timer);
      resolve();
    };
    process.on("SIGINT", onSigint);

    const timer = setInterval(() => {
      const current = resolveRun(registryPath, initial.run_id);
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

function resolveRun(registryPath: string, partial: string): RunRecord | string {
  const result = findRunByPrefix(registryPath, partial);
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
