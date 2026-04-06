import { describe, it, expect } from "vitest";
import { truncateText, type MaterializedMemory } from "../src/memory-render.js";

const emptyMemory: MaterializedMemory = { preferences: [], learnings: [], meta: [] };

describe("truncateText", () => {
  it("returns text unchanged when under budget", () => {
    const text = "short text";
    expect(truncateText(text, 100, emptyMemory)).toBe(text);
  });

  it("returns text unchanged when budget is zero (disabled)", () => {
    const text = "any text";
    expect(truncateText(text, 0, emptyMemory)).toBe(text);
  });

  it("returns text unchanged when exactly at budget", () => {
    const text = "12345";
    expect(truncateText(text, 5, emptyMemory)).toBe(text);
  });

  it("truncates on line boundary when over budget", () => {
    const text = "line one\nline two\nline three";
    const result = truncateText(text, 15, emptyMemory);
    expect(result).toContain("line one");
    expect(result).not.toContain("line three");
    expect(result).toContain("...");
    expect(result).toContain("memory truncated");
  });

  it("reports dropped bullet entries in footer", () => {
    const text = "- entry one\n- entry two\n- entry three";
    const result = truncateText(text, 20, emptyMemory);
    expect(result).toContain("entries dropped");
  });

  it("includes per-category dropped counts when memory has entries", () => {
    const memory: MaterializedMemory = {
      preferences: ["pref1", "pref2"],
      learnings: ["learn1"],
      meta: [],
    };
    // Text that has category headers with bullet items
    const text =
      "Preferences:\n- [mem-1] [cat] pref1\n- [mem-2] [cat] pref2\nLearnings:\n- [mem-3] (src) learn1";
    // Budget that keeps only first section
    const result = truncateText(text, 60, memory);
    expect(result).toContain("memory truncated");
    expect(result).toContain("learnings truncated");
  });

  it("drops nothing when budget is negative", () => {
    const text = "text";
    expect(truncateText(text, -1, emptyMemory)).toBe(text);
  });
});
