// Run-level guard checks evaluated between iterations.
//
// Guards are journal-derived (no in-memory counters), so they survive
// context reloads and apply uniformly to every continue path — routed events,
// rejected emits, and plain continues alike.

import { collectUsage, decodeEvent } from "@mobrienv/autoloop-core";
import { systemTopic } from "./emit.js";

export interface StallCheck {
  stalled: boolean;
  repeats: number;
}

export interface NoEventCheck {
  tripped: boolean;
  consecutive: number;
}

/**
 * Detect a silent loop: `threshold` (or more) consecutive COMPLETED
 * iterations (an iteration.finish present) with no accepted routing event.
 * A threshold of 0 disables the check. Grouped by iteration identity; a
 * trailing incomplete iteration is ignored (neither counted nor a break).
 * Journal-derived (no in-memory counters), so it survives context reloads
 * and resume.
 *
 * An accepted routing event is any journaled line with a non-empty topic that
 * is neither `event.invalid` nor a system topic (harness-written, incl.
 * coordination) — the exact predicates latestAgentEventRecord uses, so the
 * guard cannot drift from routing. Coordination topics (e.g.
 * `issue.discovered`) are harness-written and do NOT reset the counter.
 */
export function detectNoEvent(
  runLines: string[],
  threshold: number,
): NoEventCheck {
  if (threshold <= 0) return { tripped: false, consecutive: 0 };
  const perIteration = new Map<
    string,
    { completed: boolean; hasEvent: boolean }
  >();
  for (const line of runLines) {
    const event = decodeEvent(line);
    if (!event) continue;
    const iter = event.iteration ?? "";
    if (!iter) continue;
    const entry = perIteration.get(iter) ?? {
      completed: false,
      hasEvent: false,
    };
    if (event.topic === "iteration.finish") {
      if (event.shape === "fields") entry.completed = true;
    } else if (
      event.topic !== "" &&
      event.topic !== "event.invalid" &&
      !systemTopic(event.topic)
    ) {
      entry.hasEvent = true;
    }
    perIteration.set(iter, entry);
  }
  let consecutive = 0;
  const iterations = [...perIteration.keys()].sort(
    (a, b) => Number(a) - Number(b),
  );
  for (let i = iterations.length - 1; i >= 0; i--) {
    const entry = perIteration.get(iterations[i]);
    if (!entry) continue;
    // A trailing incomplete iteration is ignored (not counted, not a
    // break): it neither proves nor disproves silence, so counting
    // resumes at the last completed iteration.
    if (!entry.completed) continue;
    if (entry.hasEvent) break;
    consecutive++;
  }
  return { tripped: consecutive >= threshold, consecutive };
}

/**
 * Detect a no-progress loop: `threshold` (or more) consecutive iterations
 * whose backend output is byte-identical. A threshold of 0 disables the
 * check. Empty outputs never count as a stall — backend failures and
 * timeouts already have their own stop reasons.
 */
export function detectStall(runLines: string[], threshold: number): StallCheck {
  if (threshold <= 0) return { stalled: false, repeats: 0 };
  const outputs: string[] = [];
  for (const line of runLines) {
    const event = decodeEvent(line);
    if (!event || event.shape !== "fields") continue;
    if (event.topic !== "iteration.finish") continue;
    outputs.push((event.fields.output ?? "").trim());
  }
  if (outputs.length === 0) return { stalled: false, repeats: 0 };
  const last = outputs[outputs.length - 1];
  if (last === "") return { stalled: false, repeats: 0 };
  let repeats = 1;
  for (let i = outputs.length - 2; i >= 0 && outputs[i] === last; i--) {
    repeats++;
  }
  return { stalled: repeats >= threshold, repeats };
}

/**
 * Epoch-ms start of the run, from the `created_at` field of the run's
 * `loop.start` event. Null when absent or unparseable, in which case the
 * runtime budget guard disables itself.
 */
export function loopStartMs(runLines: string[]): number | null {
  for (const line of runLines) {
    const event = decodeEvent(line);
    if (!event || event.shape !== "fields") continue;
    if (event.topic !== "loop.start") continue;
    const parsed = Date.parse(event.fields.created_at ?? "");
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export interface RuntimeBudgetCheck {
  exceeded: boolean;
  elapsedMs: number;
}

/**
 * Check elapsed wall-clock time (from the journaled `loop.start` event)
 * against a runtime budget. A budget of 0 disables the check; so does a
 * missing or unparseable start timestamp.
 */
export function checkRuntimeBudget(
  runLines: string[],
  maxRuntimeMs: number,
  nowMs: number = Date.now(),
): RuntimeBudgetCheck {
  if (maxRuntimeMs <= 0) return { exceeded: false, elapsedMs: 0 };
  const startMs = loopStartMs(runLines);
  if (startMs === null) return { exceeded: false, elapsedMs: 0 };
  const elapsedMs = nowMs - startMs;
  return { exceeded: elapsedMs >= maxRuntimeMs, elapsedMs };
}

export interface CostBudgetCheck {
  exceeded: boolean;
  costUsd: number;
}

/**
 * Check accumulated run cost (from `backend.usage` events) against a USD
 * budget. A budget of 0 disables the check. Backends without usage telemetry
 * report zero cost, so the budget never fires for them.
 */
export function checkCostBudget(
  runLines: string[],
  maxCostUsd: number,
): CostBudgetCheck {
  if (maxCostUsd <= 0) return { exceeded: false, costUsd: 0 };
  const { totals } = collectUsage(runLines);
  return { exceeded: totals.costUsd >= maxCostUsd, costUsd: totals.costUsd };
}
