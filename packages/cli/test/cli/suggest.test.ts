import { describe, expect, it } from "vitest";
import {
  didYouMean,
  editDistance,
  suggestClosest,
} from "../../src/cli/suggest.js";

describe("editDistance", () => {
  it("handles equal and empty strings", () => {
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  it("computes substitutions, insertions, deletions", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("loop", "loops")).toBe(1);
  });
});

describe("suggestClosest", () => {
  const commands = ["loops", "inspect", "worktree", "doctor", "stats"];

  it("suggests near-misses", () => {
    expect(suggestClosest("lops", commands)).toBe("loops");
    expect(suggestClosest("inspct", commands)).toBe("inspect");
  });

  it("prefers prefix matches", () => {
    expect(suggestClosest("doc", commands)).toBe("doctor");
  });

  it("returns null for distant inputs and empty input", () => {
    expect(suggestClosest("zzzzzzzz", commands)).toBeNull();
    expect(suggestClosest("", commands)).toBeNull();
  });
});

describe("didYouMean", () => {
  it("renders the hint line", () => {
    expect(didYouMean("autcode", ["autocode"])).toBe(
      "Did you mean `autocode`?",
    );
  });
  it("renders nothing when no candidate is close", () => {
    expect(didYouMean("qqqqqq", ["autocode"])).toBe("");
  });
});
