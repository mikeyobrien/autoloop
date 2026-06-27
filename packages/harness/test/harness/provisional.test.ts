import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CompletionState,
  consumeHumanAck,
  nextCompletionState,
  resolveProvisional,
} from "@mobrienv/autoloop-harness/provisional";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

describe("resolveProvisional", () => {
  it("releases when both gates pass", () => {
    expect(
      resolveProvisional({
        acceptancePassed: true,
        postconditionsPassed: true,
      }),
    ).toBe("accepted");
  });

  it("holds when the acceptance gate fails", () => {
    expect(
      resolveProvisional({
        acceptancePassed: false,
        postconditionsPassed: true,
      }),
    ).toBe("held");
  });

  it("holds when postconditions fail", () => {
    expect(
      resolveProvisional({
        acceptancePassed: true,
        postconditionsPassed: false,
      }),
    ).toBe("held");
  });

  it("releases on human ack despite failing gates (fail-open override)", () => {
    expect(
      resolveProvisional({
        acceptancePassed: false,
        postconditionsPassed: false,
        humanAck: true,
      }),
    ).toBe("accepted");
  });
});

describe("nextCompletionState", () => {
  it("walks the happy path pending → awaiting → accepted", () => {
    let s: CompletionState = "pending";
    s = nextCompletionState(s, "claim");
    expect(s).toBe("awaiting_acceptance");
    s = nextCompletionState(s, "release");
    expect(s).toBe("accepted");
  });

  it("holds then re-works back to pending", () => {
    let s: CompletionState = nextCompletionState("pending", "claim");
    s = nextCompletionState(s, "hold");
    expect(s).toBe("held");
    s = nextCompletionState(s, "rework");
    expect(s).toBe("pending");
  });

  it("ignores illegal transitions", () => {
    expect(nextCompletionState("pending", "release")).toBe("pending");
    expect(nextCompletionState("accepted", "hold")).toBe("accepted");
  });
});

describe("consumeHumanAck", () => {
  function makeLoop(): LoopContext {
    const stateDir = mkdtempSync(join(tmpdir(), "autoloop-ack-"));
    mkdirSync(stateDir, { recursive: true });
    return { paths: { stateDir } } as unknown as LoopContext;
  }

  it("returns false when no ack file is present", () => {
    expect(consumeHumanAck(makeLoop())).toBe(false);
  });

  it("returns true once and consumes the ack file (one-shot)", () => {
    const loop = makeLoop();
    writeFileSync(join(loop.paths.stateDir, "release.ack"), "", "utf-8");
    expect(consumeHumanAck(loop)).toBe(true);
    // Second read: the file was consumed.
    expect(consumeHumanAck(loop)).toBe(false);
  });
});
