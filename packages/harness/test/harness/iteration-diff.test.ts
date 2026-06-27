import {
  diffIterations,
  renderIterationDiff,
} from "@mobrienv/autoloop-harness/iteration-diff";
import { describe, expect, it } from "vitest";

// Build a journal line in the spaced `"key": value` form the extractor parses.
function line(
  iteration: string,
  topic: string,
  fields: Record<string, string>,
): string {
  const parts = [
    `"run": "r"`,
    `"iteration": "${iteration}"`,
    `"topic": "${topic}"`,
  ];
  const f = Object.entries(fields)
    .map(([k, v]) => `"${k}": "${v}"`)
    .join(", ");
  return `{${parts.join(", ")}, "fields": {${f}}}`;
}

function run(): string[] {
  return [
    line("1", "iteration.start", { prompt: "do the thing\nstep one" }),
    line("1", "plan.ready", {}),
    line("1", "backend.usage", { cost_usd: "0.10" }),
    line("1", "iteration.finish", { output: "result A" }),
    line("2", "iteration.start", {
      prompt: "do the thing\nstep one\nstep two",
    }),
    line("2", "task.complete", {}),
    line("2", "backend.usage", { cost_usd: "0.25" }),
    line("2", "iteration.finish", { output: "result A then B" }),
  ];
}

describe("diffIterations", () => {
  it("reports prompt/context line+char deltas", () => {
    const d = diffIterations(run(), 1, 2);
    expect(d.prompt.changed).toBe(true);
    expect(d.prompt.linesAdded).toBe(1); // "step two" added
    expect(d.prompt.linesRemoved).toBe(0);
    expect(d.prompt.charDelta).toBeGreaterThan(0);
  });

  it("reports output delta", () => {
    const d = diffIterations(run(), 1, 2);
    expect(d.output.changed).toBe(true);
    expect(d.output.bChars).toBeGreaterThan(d.output.aChars);
  });

  it("reports the per-iteration cost delta", () => {
    const d = diffIterations(run(), 1, 2);
    expect(d.cost.aUsd).toBeCloseTo(0.1, 6);
    expect(d.cost.bUsd).toBeCloseTo(0.25, 6);
    expect(d.cost.deltaUsd).toBeCloseTo(0.15, 6);
  });

  it("diffs the emitted-event topic sets structurally", () => {
    const d = diffIterations(run(), 1, 2);
    expect(d.events.onlyInA).toContain("plan.ready");
    expect(d.events.onlyInB).toContain("task.complete");
  });

  it("reports identical when an iteration is compared to itself", () => {
    const d = diffIterations(run(), 1, 1);
    expect(d.prompt.changed).toBe(false);
    expect(d.cost.deltaUsd).toBe(0);
    expect(d.events.onlyInA).toEqual([]);
    expect(d.events.onlyInB).toEqual([]);
  });
});

describe("renderIterationDiff", () => {
  it("renders prompt/output/cost/event deltas", () => {
    const text = renderIterationDiff("r", diffIterations(run(), 1, 2));
    expect(text).toContain("Diff r: iter 1 → 2");
    expect(text).toContain("prompt/context");
    expect(text).toContain("cost:");
    expect(text).toContain("task.complete");
  });
});
