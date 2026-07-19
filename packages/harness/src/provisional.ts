import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  extractField,
  extractIteration,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { reinjectAcceptanceFailure, runAcceptanceGate } from "./acceptance.js";
import { reinjectIntentFailure, runIntentCriteria } from "./intent.js";
import {
  reinjectPostconditionFailure,
  runPostconditionGuards,
} from "./postconditions.js";
import { reinjectTamperFailure, runTamperScreen } from "./tamper.js";
import type { LoopContext } from "./types.js";

export interface DanglingProvisional {
  iteration: number;
  reason: string;
}

/** Find the latest completion claim that has no durable resolution. */
export function findDanglingProvisional(
  journalFile: string,
  runId: string,
): DanglingProvisional | null {
  const provisional = new Map<number, string>();
  const resolved = new Set<number>();

  for (const line of readRunLines(journalFile, runId)) {
    const topic = extractTopic(line);
    if (
      topic !== "completion.provisional" &&
      topic !== "completion.accepted" &&
      topic !== "completion.held"
    ) {
      continue;
    }

    const iteration = Number(extractIteration(line));
    if (!Number.isInteger(iteration)) continue;

    if (topic === "completion.provisional") {
      provisional.set(
        iteration,
        extractField(line, "reason") || "completion_event",
      );
    } else {
      resolved.add(iteration);
    }
  }

  let latest: DanglingProvisional | null = null;
  for (const [iteration, reason] of provisional) {
    if (resolved.has(iteration)) continue;
    if (!latest || iteration > latest.iteration) {
      latest = { iteration, reason };
    }
  }
  return latest;
}

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

export interface CompletionResolution {
  state: "accepted" | "held";
  humanAck: boolean;
  cause: string;
}

export interface OrphanedProvisionalOptions {
  registryIteration: number;
  resolver?: (loop: LoopContext, iteration: number) => CompletionResolution;
}

/** Run the deterministic gates and durably resolve a parked completion claim. */
export function resolveCompletionClaim(
  loop: LoopContext,
  iteration: number,
): CompletionResolution {
  // Out-of-band acceptance gate: the harness runs deterministic verify
  // commands on the done-claim.
  const gate = runAcceptanceGate(loop, iteration);
  // Required-absence guards: catch reward-hacks (leftover TODO, skipped
  // tests, secrets, dirty tree) the verify commands and LLM gates may miss.
  // Only run when the acceptance gate passed (the run is already held
  // otherwise).
  const guards = gate.passed
    ? runPostconditionGuards(loop, iteration)
    : { ran: false, passed: false, violations: [] };
  // Anti-reward-hack screen: under bypassPermissions the maker can edit the
  // very tests that gate it, so a test-backed "done" is screened for test
  // tampering before release.
  const tamper = gate.passed
    ? runTamperScreen(loop, iteration)
    : { ran: false, passed: false, violations: [] };
  // Intent-binding: the build must satisfy the stated acceptance criteria,
  // not just pass its tests.
  const intent = gate.passed
    ? runIntentCriteria(loop, iteration)
    : { ran: false, passed: false, failures: [] };
  const humanAck = consumeHumanAck(loop);
  const state = resolveProvisional({
    acceptancePassed: gate.passed,
    postconditionsPassed: guards.passed && tamper.passed && intent.passed,
    humanAck,
  });
  if (state === "accepted") {
    releaseProvisional(loop, iteration, humanAck);
    return {
      state,
      humanAck,
      cause: humanAck ? "human_ack" : "acceptance",
    };
  }

  // Held: re-inject the most specific failure and route back to rework.
  let cause = "acceptance";
  if (!gate.passed) {
    reinjectAcceptanceFailure(loop, iteration, gate);
  } else if (!guards.passed) {
    reinjectPostconditionFailure(loop, iteration, guards);
    cause = "postcondition";
  } else if (!tamper.passed) {
    reinjectTamperFailure(loop, iteration, tamper);
    cause = "tamper";
  } else {
    reinjectIntentFailure(loop, iteration, intent);
    cause = "intent";
  }
  holdProvisional(loop, iteration, cause);
  return { state: "held", humanAck, cause };
}

/**
 * Resolve a provisional completion left dangling by a process crash. Claims at
 * the registry frontier re-run the live deterministic resolution flow; claims
 * that cannot be re-run safely are durably held instead of being skipped.
 */
export function resolveOrphanedProvisional(
  loop: LoopContext,
  dangling: DanglingProvisional,
  options: OrphanedProvisionalOptions,
): "accepted" | "held" {
  if (dangling.iteration < options.registryIteration) {
    holdProvisional(
      loop,
      dangling.iteration,
      `orphaned_crash: stale provisional precedes registry iteration ${options.registryIteration}`,
    );
    return "held";
  }

  if (!existsSync(loop.paths.workDir)) {
    holdProvisional(
      loop,
      dangling.iteration,
      "orphaned_crash: work directory is unavailable",
    );
    return "held";
  }

  const resolver = options.resolver ?? resolveCompletionClaim;
  try {
    return resolver(loop, dangling.iteration).state;
  } catch (error) {
    let detail = "unknown resolver failure";
    try {
      detail = error instanceof Error ? error.message : String(error);
    } catch {
      // The thrown value itself may not be safely stringifiable.
    }
    holdProvisional(
      loop,
      dangling.iteration,
      `orphaned_crash: completion gates could not be re-run (${detail})`,
    );
    return "held";
  }
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
    `${jsonField("state", "held")}, ${jsonField("cause", cause)}`,
  );
  loop.onEvent?.({
    type: "failure.diagnostic",
    output: `Completion parked: a done-claim was held at the acceptance gate (${cause}). Not proceeding to any irreversible action.`,
    stopReason: "completion_held",
  });
}
