// Exhaustiveness guard for the versioned `StopReason` termination contract
// (issue #37). Two complementary checks:
//
// 1. A `switch` over every literal, with a `never`-typed `default` — this
//    makes it a *compile-time* error (caught by `tsc` / vitest's type
//    checking) to add a 25th literal to `StopReason` without updating the
//    switch here.
// 2. A source-scan regression test over the known producer files (stop.ts,
//    index.ts, iteration.ts, provisional.ts, circuit-breaker.ts,
//    wave.ts, wave/finalize-wave.ts) that greps for `stopReason: "..."` /
//    `reason: "..."` literals and asserts every one is a member of
//    `STOP_REASONS` — this is the belt-and-suspenders net for the more
//    likely real-world drift: a new ad-hoc string literal added at a call
//    site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOP_REASONS,
  type StopReason,
} from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

const harnessSrcRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
);

/** Unreachable at runtime; exists purely so `tsc` fails to compile if a
 * `StopReason` literal is missing from the switch below. */
function assertExhaustive(value: never): never {
  throw new Error(`unreachable StopReason literal: ${String(value)}`);
}

function isKnownStopReason(reason: StopReason): true {
  switch (reason) {
    case "completed":
    case "completion_event":
    case "completion_promise":
    case "backend_failed":
    case "backend_timeout":
    case "auth_failed":
    case "quota_exhausted":
    case "rate_limited":
    case "transient_error":
    case "review_unknown":
    case "max_iterations":
    case "stalled":
    case "cost_budget":
    case "max_runtime":
    case "premature_quit":
    case "interrupted":
    case "verdict_exit":
    case "verdict_takeover":
    case "verdict_unknown":
    case "completion_held":
    case "suspended":
    case "parallel_wave_timeout":
    case "parallel_wave_failed":
    case "parallel_wave_invalid":
    case "error":
      return true;
    default:
      // If a 25th literal is ever added to StopReason without a case here,
      // this line fails to *compile* (never-typed exhaustiveness check).
      return assertExhaustive(reason);
  }
}

describe("StopReason exhaustiveness", () => {
  it("has exactly the 25 documented literals (23 from the issue + parallel_wave_invalid + suspended from lifecycle hooks)", () => {
    expect(STOP_REASONS.length).toBe(25);
    expect(new Set(STOP_REASONS).size).toBe(STOP_REASONS.length);
  });

  it("every STOP_REASONS member is handled by the compile-time exhaustiveness switch", () => {
    for (const reason of STOP_REASONS) {
      expect(isKnownStopReason(reason)).toBe(true);
    }
  });

  it("contains all 23 values enumerated by issue #37", () => {
    const required: StopReason[] = [
      "completed",
      "completion_event",
      "completion_promise",
      "backend_failed",
      "backend_timeout",
      "auth_failed",
      "quota_exhausted",
      "rate_limited",
      "transient_error",
      "review_unknown",
      "max_iterations",
      "stalled",
      "cost_budget",
      "max_runtime",
      "premature_quit",
      "interrupted",
      "error",
      "verdict_exit",
      "verdict_takeover",
      "verdict_unknown",
      "completion_held",
      "parallel_wave_timeout",
      "parallel_wave_failed",
    ];
    expect(required.length).toBe(23);
    for (const reason of required) {
      expect(STOP_REASONS).toContain(reason);
    }
  });
});

describe("StopReason producer source scan (regression net)", () => {
  // Terminal producer files documented on StopReason in types.ts. This list
  // must stay in sync with that doc comment.
  const producerFiles = [
    "stop.ts",
    "index.ts",
    "iteration.ts",
    "provisional.ts",
    "circuit-breaker.ts",
    "wave.ts",
    "wave/finalize-wave.ts",
  ];

  // Non-terminal sentinel values that legitimately appear at these call
  // sites but are never assigned to `RunSummary.stopReason` — documented
  // exceptions, not StopReason bugs.
  const nonTerminalExceptions = new Set(["parallel_wave_complete"]);

  it("every string literal assigned to a stopReason/reason field is a known StopReason (or a documented non-terminal exception)", () => {
    const allowed = new Set<string>([
      ...STOP_REASONS,
      ...nonTerminalExceptions,
    ]);
    const found = new Set<string>();

    for (const file of producerFiles) {
      const text = readFileSync(join(harnessSrcRoot, file), "utf8");
      for (const m of text.matchAll(
        /\b(?:stopReason|reason)\s*:\s*"([a-z_]+)"/g,
      )) {
        found.add(m[1]);
      }
    }

    expect(found.size).toBeGreaterThan(0);
    for (const literal of found) {
      expect(
        allowed.has(literal),
        `literal "${literal}" found in a producer file is not in STOP_REASONS ` +
          `and is not a documented non-terminal exception`,
      ).toBe(true);
    }
  });
});
