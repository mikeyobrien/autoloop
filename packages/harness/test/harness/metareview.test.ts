import { shouldRunMetareview } from "@mobrienv/autoloop-harness/metareview";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

function makeLoop(enabled: boolean, every: number): LoopContext {
  return {
    review: {
      enabled,
      every,
      kind: "command",
      command: "echo",
      args: [],
      promptMode: "arg",
      prompt: "",
      timeoutMs: 5000,
    },
  } as unknown as LoopContext;
}

describe("shouldRunMetareview", () => {
  it("returns false when review is disabled", () => {
    expect(shouldRunMetareview(makeLoop(false, 1), 5)).toBe(false);
  });

  it("returns false on iteration 1 even if enabled", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 1)).toBe(false);
  });

  it("returns true on iteration 2 with every=1", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 2)).toBe(true);
  });

  it("returns true on iteration 3 with every=1", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 3)).toBe(true);
  });

  it("returns false on iteration 2 with every=3", () => {
    // (2-1) % 3 === 1, not 0
    expect(shouldRunMetareview(makeLoop(true, 3), 2)).toBe(false);
  });

  it("returns false on iteration 3 with every=3", () => {
    // (3-1) % 3 === 2, not 0
    expect(shouldRunMetareview(makeLoop(true, 3), 3)).toBe(false);
  });

  it("returns true on iteration 4 with every=3", () => {
    // (4-1) % 3 === 0
    expect(shouldRunMetareview(makeLoop(true, 3), 4)).toBe(true);
  });

  it("returns true on iteration 7 with every=3", () => {
    // (7-1) % 3 === 0
    expect(shouldRunMetareview(makeLoop(true, 3), 7)).toBe(true);
  });

  it("returns true on iteration 6 with every=5", () => {
    // (6-1) % 5 === 0
    expect(shouldRunMetareview(makeLoop(true, 5), 6)).toBe(true);
  });

  it("returns false on iteration 5 with every=5", () => {
    // (5-1) % 5 === 4
    expect(shouldRunMetareview(makeLoop(true, 5), 5)).toBe(false);
  });
});
