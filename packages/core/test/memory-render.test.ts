import { describe, expect, it } from "vitest";
import { type MaterializedMemory, truncateText } from "../src/memory-render.js";

const emptyMemory: MaterializedMemory = {
  preferences: [],
  learnings: [],
  meta: [],
};

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

describe("two-tier truncation ordering", () => {
  it("drops run memory entries before project entries", () => {
    // Combined memory for truncation detail tracking
    const combined: MaterializedMemory = {
      preferences: ["pref1"],
      learnings: ["learn1", "learn2"],
      meta: ["meta1"],
    };
    // Simulate two-tier rendered text: project first, run second
    const text =
      "Loop memory:\nProject memory:\nPreferences:\n- [mem-1] [cat] pref1\nRun memory:\nLearnings:\n- [mem-1] (s) learn1\n- [mem-2] (s) learn2\nMeta:\n- [meta-1] k: v";
    // Budget that fits project section but not run
    const projEnd = text.indexOf("Run memory:");
    const budget = projEnd + 5;
    const result = truncateText(text, budget, combined);
    expect(result).toContain("Project memory:");
    expect(result).toContain("pref1");
    expect(result).toContain("memory truncated");
    expect(result).not.toContain("meta-1");
  });
});
