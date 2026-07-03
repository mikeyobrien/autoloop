import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "./types.js";

/**
 * Completion lifecycle. A self-asserted done-claim never flows straight to an
 * irreversible action (automerge/PR/publish): it parks in `awaiting_acceptance`
 * until the deterministic gates pass (or a human acknowledges), then resolves to
 * `accepted` (release) or `held` (rework / attention).
 */
export type CompletionState =
  | "pending"
  | "awaiting_acceptance"
  | "accepted"
  | "held";

export interface AcceptanceSignals {
  /** The out-of-band acceptance gate (verify_cmds) passed. */
  acceptancePassed: boolean;
  /** The required-absence postcondition guards passed. */
  postconditionsPassed: boolean;
  /** An operator explicitly acknowledged release despite the gates. */
  humanAck?: boolean;
}

/**
 * Resolve a parked (`awaiting_acceptance`) completion. A human acknowledgement
 * releases unconditionally; otherwise release requires BOTH deterministic gates
 * to pass. Anything else holds — fail-closed.
 */
export function resolveProvisional(
  signals: AcceptanceSignals,
): CompletionState {
  if (signals.humanAck) return "accepted";
  return signals.acceptancePassed && signals.postconditionsPassed
    ? "accepted"
    : "held";
}

/**
 * Explicit FSM transition, used for reasoning/tests. Only the legal edges move
 * state; an illegal (current, event) pair is a no-op that returns `current`.
 */
export function nextCompletionState(
  current: CompletionState,
  event: "claim" | "release" | "hold" | "rework",
): CompletionState {
  switch (current) {
    case "pending":
      return event === "claim" ? "awaiting_acceptance" : current;
    case "awaiting_acceptance":
      if (event === "release") return "accepted";
      if (event === "hold") return "held";
      return current;
    case "held":
      // A held run returns to rework (back-edge) and can re-claim later.
      if (event === "rework") return "pending";
      if (event === "release") return "accepted";
      return current;
    default:
      return current;
  }
}

const ACK_FILE = "release.ack";

/**
 * One-shot operator acknowledgement: if `<stateDir>/release.ack` exists, the
 * operator has authorized release despite the gates. The file is consumed
 * (removed) so the ack applies to a single completion only.
 */
export function consumeHumanAck(loop: LoopContext): boolean {
  const path = join(loop.paths.stateDir, ACK_FILE);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
  } catch {
    /* best-effort: a stuck ack file is harmless, it just re-acks next time */
  }
  return true;
}

/** Journal entry into the parked state before any irreversible action. */
export function enterProvisional(
  loop: LoopContext,
  iteration: number,
  reason: string,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "completion.provisional",
    jsonField("state", "awaiting_acceptance") +
      ", " +
      jsonField("reason", reason),
  );
  loop.onEvent?.({
    type: "progress",
    runId: loop.runtime.runId,
    iteration,
    recentEvent: "completion.provisional",
    allowedRoles: [],
    outcome: "provisional:awaiting_acceptance",
  });
}

/** Journal release of a parked completion (gates passed or human ack). */
export function releaseProvisional(
  loop: LoopContext,
  iteration: number,
  humanAck: boolean,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "completion.accepted",
    jsonField("state", "accepted") +
      ", " +
      jsonFieldRaw("human_ack", jsonBool(humanAck)),
  );
}

/**
 * Journal a held completion and raise attention. The loop does not advance to
 * an irreversible action; it routes back to rework on the next iteration.
 */
export function holdProvisional(
  loop: LoopContext,
  iteration: number,
  cause: string,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "completion.held",
    jsonField("state", "held") + ", " + jsonField("cause", cause),
  );
  loop.onEvent?.({
    type: "failure.diagnostic",
    output: `Completion parked: a done-claim was held at the acceptance gate (${cause}). Not proceeding to any irreversible action.`,
    stopReason: "completion_held",
  });
}
