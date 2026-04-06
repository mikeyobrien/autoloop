import { describe, it, expect } from "vitest";
import {
  parseParallelObjectives,
  parseObjectiveLine,
} from "../../src/harness/wave/parse-objectives.js";

describe("parseObjectiveLine", () => {
  it("parses dash-prefixed lines", () => {
    expect(parseObjectiveLine("- fix the bug")).toBe("fix the bug");
  });

  it("parses asterisk-prefixed lines", () => {
    expect(parseObjectiveLine("* add tests")).toBe("add tests");
  });

  it("parses numbered lines", () => {
    expect(parseObjectiveLine("1. first task")).toBe("first task");
    expect(parseObjectiveLine("12. twelfth task")).toBe("twelfth task");
  });

  it("trims whitespace from parsed objective", () => {
    expect(parseObjectiveLine("-   spaced out  ")).toBe("spaced out");
  });

  it("returns empty string for unrecognized formats", () => {
    expect(parseObjectiveLine("plain text")).toBe("");
    expect(parseObjectiveLine("")).toBe("");
    expect(parseObjectiveLine("a. lettered item")).toBe("");
  });

  it("returns empty for line with dot but non-numeric prefix", () => {
    expect(parseObjectiveLine("abc. not numbered")).toBe("");
  });
});

describe("parseParallelObjectives", () => {
  it("parses a valid bullet list", () => {
    const result = parseParallelObjectives("- task A\n- task B", 5);
    expect(result).toEqual({ ok: true, objectives: ["task A", "task B"], reason: "" });
  });

  it("parses a valid numbered list", () => {
    const result = parseParallelObjectives("1. first\n2. second", 5);
    expect(result).toEqual({ ok: true, objectives: ["first", "second"], reason: "" });
  });

  it("skips blank lines between items", () => {
    const result = parseParallelObjectives("- a\n\n- b\n", 5);
    expect(result.ok).toBe(true);
    expect(result.objectives).toEqual(["a", "b"]);
  });

  it("returns invalid for mixed valid and invalid lines", () => {
    const result = parseParallelObjectives("- valid\nplain text", 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_branch_list");
  });

  it("returns empty_branch_list for no content", () => {
    const result = parseParallelObjectives("", 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty_branch_list");
  });

  it("returns empty_branch_list for only whitespace", () => {
    const result = parseParallelObjectives("  \n  \n  ", 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty_branch_list");
  });

  it("returns too_many_branches when exceeding max", () => {
    const result = parseParallelObjectives("- a\n- b\n- c", 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_many_branches");
  });

  it("allows exactly maxBranches items", () => {
    const result = parseParallelObjectives("- a\n- b", 2);
    expect(result.ok).toBe(true);
    expect(result.objectives).toHaveLength(2);
  });
});
