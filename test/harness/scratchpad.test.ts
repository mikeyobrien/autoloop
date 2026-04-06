import { describe, it, expect } from "vitest";
import { encodeEvent } from "../../src/events/encode.js";
import {
  renderRunScratchpadFull,
  renderRunScratchpadPrompt,
} from "../../src/harness/scratchpad.js";

function iterFinishLine(iteration: string, exitCode: string, output: string): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration,
    topic: "iteration.finish",
    fields: { exit_code: exitCode, output },
    rawFields: { exit_code: exitCode, output },
  }).trim();
}

function otherLine(topic: string): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration: "1",
    topic,
    fields: {},
    rawFields: {},
  }).trim();
}

describe("renderRunScratchpadFull", () => {
  it("returns empty string for no lines", () => {
    expect(renderRunScratchpadFull([])).toBe("");
  });

  it("renders a single iteration finish", () => {
    const lines = [iterFinishLine("1", "0", "All tests passed")];
    const result = renderRunScratchpadFull(lines);
    expect(result).toContain("## Iteration 1");
    expect(result).toContain("exit_code=0");
    expect(result).toContain("All tests passed");
  });

  it("ignores non-iteration.finish events", () => {
    const lines = [
      otherLine("iteration.start"),
      iterFinishLine("1", "0", "done"),
      otherLine("backend.finish"),
    ];
    const result = renderRunScratchpadFull(lines);
    expect(result).toContain("## Iteration 1");
    expect(result).not.toContain("iteration.start");
    expect(result).not.toContain("backend.finish");
  });

  it("renders multiple iterations in order", () => {
    const lines = [
      iterFinishLine("1", "0", "first"),
      iterFinishLine("2", "1", "second"),
    ];
    const result = renderRunScratchpadFull(lines);
    expect(result).toContain("## Iteration 1");
    expect(result).toContain("## Iteration 2");
    const pos1 = result.indexOf("Iteration 1");
    const pos2 = result.indexOf("Iteration 2");
    expect(pos1).toBeLessThan(pos2);
  });
});

describe("renderRunScratchpadPrompt", () => {
  it("renders all entries when 4 or fewer", () => {
    const lines = [
      iterFinishLine("1", "0", "a"),
      iterFinishLine("2", "0", "b"),
      iterFinishLine("3", "0", "c"),
      iterFinishLine("4", "0", "d"),
    ];
    const result = renderRunScratchpadPrompt(lines);
    expect(result).toContain("## Iteration 1");
    expect(result).toContain("## Iteration 4");
    expect(result).not.toContain("compacted");
  });

  it("compacts earlier entries when more than 4", () => {
    const lines = [
      iterFinishLine("1", "0", "first output"),
      iterFinishLine("2", "0", "second output"),
      iterFinishLine("3", "0", "third output"),
      iterFinishLine("4", "0", "fourth output"),
      iterFinishLine("5", "0", "fifth output"),
    ];
    const result = renderRunScratchpadPrompt(lines);
    // First entry should be compacted (bullet item, not full heading)
    expect(result).toContain("Earlier iterations (compacted)");
    expect(result).toContain("Iteration 1 exit_code=0");
    // Last 4 should be full
    expect(result).toContain("## Iteration 2");
    expect(result).toContain("## Iteration 5");
  });

  it("compacts multiple earlier entries when 6+", () => {
    const lines = Array.from({ length: 6 }, (_, i) =>
      iterFinishLine(String(i + 1), "0", `output ${i + 1}`),
    );
    const result = renderRunScratchpadPrompt(lines);
    expect(result).toContain("Earlier iterations (compacted)");
    // Iterations 1 and 2 compacted
    expect(result).toContain("Iteration 1 exit_code=0");
    expect(result).toContain("Iteration 2 exit_code=0");
    // Iterations 3-6 full
    expect(result).toContain("## Iteration 3");
    expect(result).toContain("## Iteration 6");
  });

  it("truncates long output in compact summary to 120 chars", () => {
    const longOutput = "x".repeat(200);
    const lines = [
      iterFinishLine("1", "0", longOutput),
      iterFinishLine("2", "0", "a"),
      iterFinishLine("3", "0", "b"),
      iterFinishLine("4", "0", "c"),
      iterFinishLine("5", "0", "d"),
    ];
    const result = renderRunScratchpadPrompt(lines);
    expect(result).toContain("x".repeat(120) + "...");
  });

  it("shows (no output) for empty output in compact summary", () => {
    const lines = [
      iterFinishLine("1", "0", ""),
      iterFinishLine("2", "0", "a"),
      iterFinishLine("3", "0", "b"),
      iterFinishLine("4", "0", "c"),
      iterFinishLine("5", "0", "d"),
    ];
    const result = renderRunScratchpadPrompt(lines);
    expect(result).toContain("(no output)");
  });
});
