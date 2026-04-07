import { describe, expect, it } from "vitest";
import {
  eventOneLiner,
  topicCategory,
  topicMatchesFilter,
} from "../src/harness/journal-format.js";

describe("topicCategory", () => {
  it("maps loop.* to loop", () => {
    expect(topicCategory("loop.start")).toBe("loop");
    expect(topicCategory("loop.complete")).toBe("loop");
  });

  it("maps iteration.* to iteration", () => {
    expect(topicCategory("iteration.finish")).toBe("iteration");
  });

  it("maps backend.* to backend", () => {
    expect(topicCategory("backend.request")).toBe("backend");
  });

  it("maps review.* to review", () => {
    expect(topicCategory("review.passed")).toBe("review");
  });

  it("maps coordination topics", () => {
    expect(topicCategory("issue.created")).toBe("coordination");
    expect(topicCategory("slice.committed")).toBe("coordination");
    expect(topicCategory("context.updated")).toBe("coordination");
    expect(topicCategory("chain.started")).toBe("coordination");
    expect(topicCategory("artifact.created")).toBe("coordination");
  });

  it("maps operator.* to operator", () => {
    expect(topicCategory("operator.guidance")).toBe("operator");
  });

  it("maps wave.* to routing", () => {
    expect(topicCategory("wave.start")).toBe("routing");
  });

  it("maps event.invalid to error", () => {
    expect(topicCategory("event.invalid")).toBe("error");
  });

  it("maps loop.stop to error", () => {
    expect(topicCategory("loop.stop")).toBe("error");
  });

  it("maps unknown topics to routing", () => {
    expect(topicCategory("unknown.thing")).toBe("routing");
  });
});

describe("topicMatchesFilter", () => {
  it("matches exact topic", () => {
    expect(topicMatchesFilter("loop.start", "loop.start")).toBe(true);
  });

  it("matches by category name", () => {
    expect(topicMatchesFilter("loop.start", "loop")).toBe(true);
    expect(topicMatchesFilter("loop.complete", "loop")).toBe(true);
  });

  it("rejects non-matching category", () => {
    expect(topicMatchesFilter("loop.start", "iteration")).toBe(false);
  });

  it("matches glob patterns with *", () => {
    expect(topicMatchesFilter("loop.start", "loop.*")).toBe(true);
    expect(topicMatchesFilter("loop.complete", "loop.*")).toBe(true);
    expect(topicMatchesFilter("iteration.start", "loop.*")).toBe(false);
  });

  it("matches wildcard-only pattern", () => {
    expect(topicMatchesFilter("anything.here", "*")).toBe(true);
  });

  it("escapes regex metacharacters in pattern", () => {
    // A pattern with regex metachar should be treated literally
    expect(topicMatchesFilter("loop|error", "loop|error")).toBe(true);
    // The pipe should NOT act as regex alternation
    expect(topicMatchesFilter("loop", "loop|error")).toBe(false);
    expect(topicMatchesFilter("error", "loop|error")).toBe(false);
  });

  it("escapes parentheses in pattern", () => {
    expect(topicMatchesFilter("test(1)", "test(1)")).toBe(true);
    expect(topicMatchesFilter("test1", "test(1)")).toBe(false);
  });

  it("escapes brackets in pattern", () => {
    expect(topicMatchesFilter("a[0]", "a[0]")).toBe(true);
    expect(topicMatchesFilter("a0", "a[0]")).toBe(false);
  });

  it("handles glob with metacharacters", () => {
    // "foo+.*" should match "foo+.bar" literally
    expect(topicMatchesFilter("foo+.bar", "foo+.*")).toBe(true);
    expect(topicMatchesFilter("foooo.bar", "foo+.*")).toBe(false);
  });
});

describe("eventOneLiner", () => {
  it("formats a payload event", () => {
    const line = JSON.stringify({
      topic: "loop.start",
      timestamp: "2025-01-01T00:00:00Z",
      payload: "loop started",
    });
    const event = {
      topic: "loop.start",
      shape: "payload" as const,
      payload: "loop started",
      run: undefined,
      iteration: undefined,
    };
    const result = eventOneLiner(line, event, 80);
    expect(result).toContain("loop.start");
    expect(result).toContain("loop started");
  });
});
