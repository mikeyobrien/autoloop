import type { BackendErrorClass } from "@mobrienv/autoloop-backends";
import { extractTopic } from "@mobrienv/autoloop-core/journal";

export interface CircuitDecision {
  /** `pause`: back off and retry the run; `stop`: terminate with `reason`. */
  action: "pause" | "stop";
  /** Typed stop reason to journal (also used as the pause's error class). */
  reason: string;
}

/**
 * Circuit-breaker policy for a classified backend error. Non-retryable classes
 * (auth/quota) stop immediately with a typed reason. Retryable classes
 * (rate-limit/transient) pause-and-retry rather than fast-failing, until the
 * breaker opens after `maxPauses` pauses — then they stop with the typed reason
 * instead of being laundered into a confident verdict or a generic failure.
 */
export function circuitDecision(
  errorClass: BackendErrorClass,
  transientPauseCount: number,
  maxPauses: number,
): CircuitDecision {
  switch (errorClass) {
    case "auth_failed":
      return { action: "stop", reason: "auth_failed" };
    case "quota_exhausted":
      return { action: "stop", reason: "quota_exhausted" };
    case "rate_limited":
    case "transient_error":
      return transientPauseCount >= maxPauses
        ? { action: "stop", reason: errorClass }
        : { action: "pause", reason: errorClass };
    default:
      // An unclassified failure is a plain backend failure.
      return { action: "stop", reason: "backend_failed" };
  }
}

/** How many transient pauses this run has already taken (breaker memory). */
export function countTransientPauses(runLines: string[]): number {
  return runLines.filter((l) => extractTopic(l) === "backend.transient").length;
}

/**
 * Exponential backoff for the retry ladder: `base * 2^(attempt-1)`, clamped to
 * `cap` and never negative. `attempt` is 1-indexed (the first retry waits
 * `base`). A `base` of 0 disables the wait entirely (used in tests).
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
): number {
  if (baseMs <= 0) return 0;
  const n = Math.max(1, Math.floor(attempt));
  const delay = baseMs * 2 ** (n - 1);
  return Math.min(Math.max(0, capMs), delay);
}
