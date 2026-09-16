import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { appendRegistryEntry } from "@mobrienv/autoloop-core/registry/update";
import { openWaitFromLines } from "./wait.js";

export interface AbandonResult {
  runId: string;
  from: "waiting";
  to: "stopped";
  journalFile: string;
  registryFile: string;
}

export interface AbandonFailure {
  error: string;
}

/**
 * Explicit retire path for parked runs (T-033).
 *
 * A `waiting` run is process-free: the engine exited 0 after stopWaiting, so
 * nothing drains control requests for it (pokeParent no-ops on non-running
 * runs and the parent process is gone). The only way out was a resume. This
 * command appends the correction instead:
 *
 * - journal: closes the unmatched wait.open (wait.close) if one is open, then
 *   appends `loop.stop` reason=abandoned — journal-derived views (rebuild)
 *   end at stopped/abandoned instead of resurrecting the park.
 * - registry: appends one corrected entry (append-only discipline, same
 *   pattern as reapStaleRuns / registryTerminal) with status stopped,
 *   stop_reason abandoned, no pid.
 *
 * Non-waiting runs are refused before any write: the caller must not be able
 * to mutate completed/failed/running records through this surface.
 */
export function abandonRun(
  record: RunRecord,
  io: { registryFile: string; journalFile: string; reason: string },
  nowIso: string = new Date().toISOString(),
): AbandonResult | AbandonFailure {
  if (record.status !== "waiting") {
    return {
      error:
        `run ${record.run_id} is ${record.status}, not waiting — abandon only retires parked runs ` +
        `(nothing was written)`,
    };
  }

  // The engine wrote this run's rows into the registry that sits beside its
  // journal (top-level journal → project registry; worktree journal →
  // worktree registry). Correct the same file the record came from so the
  // append lands where readers of this run look.
  const registryFile =
    record.journal_file && existsSync(record.journal_file)
      ? join(dirname(record.journal_file), "registry.jsonl")
      : io.registryFile;
  const journalFile = record.journal_file || io.journalFile;

  // Close the open wait if one is unmatched, mirroring what a resume would
  // have journaled — one wait.close per wait.open, preserved by construction.
  try {
    const lines = readFileSync(journalFile, "utf-8").split("\n");
    const open = openWaitFromLines(lines, record.run_id);
    if (open) {
      appendEvent(
        journalFile,
        record.run_id,
        "",
        "wait.close",
        jsonField("wait_id", open.waitId) +
          ", " +
          jsonField("detail", io.reason || "abandoned"),
      );
    }
  } catch {
    /* journal unreadable: still append the loop.stop + registry correction */
  }

  appendEvent(
    journalFile,
    record.run_id,
    "",
    "loop.stop",
    jsonField("reason", "abandoned") +
      ", " +
      jsonField("detail", io.reason || "abandoned"),
  );

  const corrected: RunRecord = { ...record };
  corrected.status = "stopped";
  corrected.stop_reason = "abandoned";
  corrected.updated_at = nowIso;
  corrected.latest_event = "loop.stop";
  delete corrected.pid;
  corrected.outcome = "stopped";
  corrected.acceptance_verified = false;
  appendRegistryEntry(registryFile, corrected);

  return {
    runId: record.run_id,
    from: "waiting",
    to: "stopped",
    journalFile,
    registryFile,
  };
}
