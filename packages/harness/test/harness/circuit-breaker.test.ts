import {
  backoffDelayMs,
  circuitDecision,
  countTransientPauses,
} from "@mobrienv/autoloop-harness/circuit-breaker";
import { describe, expect, it } from "vitest";

describe("backoffDelayMs", () => {
  it("grows exponentially from the base", () => {
    expect(backoffDelayMs(1, 1000, 30000)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 30000)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 30000)).toBe(4000);
    expect(backoffDelayMs(4, 1000, 30000)).toBe(8000);
  });
  it("clamps to the cap", () => {
    expect(backoffDelayMs(10, 5000, 30000)).toBe(30000);
  });
  it("returns 0 when the base is 0 (disabled)", () => {
    expect(backoffDelayMs(3, 0, 30000)).toBe(0);
  });
  it("treats attempt < 1 as the first attempt", () => {
    expect(backoffDelayMs(0, 1000, 30000)).toBe(1000);
  });
});

describe("circuitDecision", () => {
  it("stops immediately on auth failure (non-retryable)", () => {
    expect(circuitDecision("auth_failed", 0, 3)).toEqual({
      action: "stop",
      reason: "auth_failed",
    });
  });

  it("stops immediately on quota exhaustion (non-retryable)", () => {
    expect(circuitDecision("quota_exhausted", 0, 3)).toEqual({
      action: "stop",
      reason: "quota_exhausted",
    });
  });

  it("pauses a rate-limit error while under the breaker threshold", () => {
    expect(circuitDecision("rate_limited", 0, 3)).toEqual({
      action: "pause",
      reason: "rate_limited",
    });
    expect(circuitDecision("transient_error", 2, 3)).toEqual({
      action: "pause",
      reason: "transient_error",
    });
  });

  it("opens the breaker (stops) once pauses reach the threshold", () => {
    expect(circuitDecision("rate_limited", 3, 3)).toEqual({
      action: "stop",
      reason: "rate_limited",
    });
    expect(circuitDecision("transient_error", 5, 3)).toEqual({
      action: "stop",
      reason: "transient_error",
    });
  });

  it("treats an unclassified error as a plain backend failure", () => {
    expect(circuitDecision("none", 0, 3)).toEqual({
      action: "stop",
      reason: "backend_failed",
    });
  });

  it("with maxPauses=0 stops on the first transient error", () => {
    expect(circuitDecision("rate_limited", 0, 0).action).toBe("stop");
  });
});

describe("countTransientPauses", () => {
  const line = (topic: string) => JSON.stringify({ run: "r", topic });

  it("counts backend.transient markers in the run", () => {
    const lines = [
      line("loop.start"),
      line("backend.transient"),
      line("iteration.finish"),
      line("backend.transient"),
    ];
    expect(countTransientPauses(lines)).toBe(2);
  });

  it("returns 0 when there are none", () => {
    expect(countTransientPauses([line("loop.start")])).toBe(0);
  });
});
