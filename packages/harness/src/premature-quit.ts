import { jsonField } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
  extractTopic,
} from "@mobrienv/autoloop-core/journal";
import { materializeOpenFrom } from "@mobrienv/autoloop-core/tasks";
import type { LoopContext } from "./types.js";

export interface PrematureQuitCheck {
  /** True when the run is quitting with authorized work left and no blocker. */
  premature: boolean;
  /** Human-readable reasons (open task ids, unmet required events). */
  reasons: string[];
}

/**
 * Detect an announce-then-halt / silent drift-stop: the loop is stopping (e.g.
 * a stall) but authorized work remains AND nothing is blocking it. That is a
 * false finish that quietly under-delivers, distinct from a legitimate stop.
 *
 * Work remaining = open non-soft tasks OR unmet required completion events.
 * Blocker = a transient/availability pause on the latest turn (an availability
 * issue, not a premature quit).
 */
export function detectPrematureQuit(
  loop: LoopContext,
  runLines: string[],
): PrematureQuitCheck {
  const reasons: string[] = [];

  const openTasks = materializeOpenFrom(loop.paths.tasksFile).filter(
    (t) => t.soft !== true,
  );
  if (openTasks.length) {
    reasons.push(
      `${openTasks.length} open task(s): ${openTasks.map((t) => t.id).join(", ")}`,
    );
  }

  const topics = new Set(runLines.map((l) => extractTopic(l)));
  const unmet = loop.completion.requiredEvents.filter((e) => !topics.has(e));
  if (unmet.length) {
    reasons.push(`unmet required event(s): ${unmet.join(", ")}`);
  }

  // A transient/availability pause on the latest turn is a real blocker, not a
  // premature quit — let the circuit breaker own it.
  const blocked = lastNonSystemSignalIsTransient(runLines);

  return { premature: reasons.length > 0 && !blocked, reasons };
}

function lastNonSystemSignalIsTransient(runLines: string[]): boolean {
  for (let i = runLines.length - 1; i >= 0; i--) {
    const topic = extractTopic(runLines[i]);
    if (topic === "backend.transient") return true;
    if (topic === "iteration.finish") return false;
  }
  return false;
}

/** How many times this run has already been re-armed (bound the re-arm loop). */
export function countRearms(runLines: string[]): number {
  return runLines.filter((l) => extractTopic(l) === "premature.rearm").length;
}

/**
 * Re-arm a premature quit: journal the re-arm and inject a nudge so the next
 * iteration's prompt differs (breaking the stall) and the agent finishes the
 * remaining authorized work instead of halting.
 */
export function rearmPrematureQuit(
  loop: LoopContext,
  iteration: number,
  check: PrematureQuitCheck,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "premature.rearm",
    jsonField("reasons", check.reasons.join("; ")),
  );
  appendOperatorEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance",
    "You stopped with authorized work remaining and no blocker. Do not halt: " +
      "continue and finish the remaining work, then emit the completion event. " +
      `Remaining:\n- ${check.reasons.join("\n- ")}`,
  );
}
