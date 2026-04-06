import { describe, it, expect } from "vitest";
import { encodeEvent } from "../../src/events/encode.js";
import { renderChainLines } from "../../src/chains/render.js";

function fieldsLine(
  topic: string,
  fields: Record<string, string>,
): string {
  return encodeEvent({
    shape: "fields",
    run: "r1",
    iteration: "1",
    topic,
    fields,
    rawFields: fields,
  }).trim();
}

describe("renderChainLines", () => {
  it("returns placeholder for no chain events", () => {
    expect(renderChainLines([])).toBe("(no chain runs found)");
  });

  it("returns placeholder when lines have no chain topics", () => {
    const lines = [
      fieldsLine("iteration.start", {}),
      fieldsLine("task.complete", {}),
    ];
    expect(renderChainLines(lines)).toBe("(no chain runs found)");
  });

  it("renders chain.start", () => {
    const lines = [
      fieldsLine("chain.start", { name: "deploy", steps: "3" }),
    ];
    const result = renderChainLines(lines);
    expect(result).toContain("## Chain: deploy");
    expect(result).toContain("Steps: 3");
  });

  it("renders chain.step.start and chain.step.finish", () => {
    const lines = [
      fieldsLine("chain.start", { name: "build", steps: "2" }),
      fieldsLine("chain.step.start", { step: "1", preset: "lint" }),
      fieldsLine("chain.step.finish", { step: "1", preset: "lint", stop_reason: "completed" }),
    ];
    const result = renderChainLines(lines);
    expect(result).toContain("Step 1 (lint) started");
    expect(result).toContain("Step 1 (lint) finished: completed");
  });

  it("renders chain.complete", () => {
    const lines = [
      fieldsLine("chain.start", { name: "ci", steps: "2" }),
      fieldsLine("chain.complete", { outcome: "success", steps_completed: "2" }),
    ];
    const result = renderChainLines(lines);
    expect(result).toContain("Outcome: success (2 steps completed)");
  });

  it("renders chain.spawn", () => {
    const lines = [
      fieldsLine("chain.spawn", {
        chain_id: "child-1",
        parent_id: "parent-1",
        steps: "1",
      }),
    ];
    const result = renderChainLines(lines);
    expect(result).toContain("Spawned: child-1 (parent: parent-1, steps: 1)");
  });

  it("renders full chain lifecycle in order", () => {
    const lines = [
      fieldsLine("chain.start", { name: "full", steps: "2" }),
      fieldsLine("chain.step.start", { step: "1", preset: "test" }),
      fieldsLine("chain.step.finish", { step: "1", preset: "test", stop_reason: "done" }),
      fieldsLine("chain.step.start", { step: "2", preset: "deploy" }),
      fieldsLine("chain.step.finish", { step: "2", preset: "deploy", stop_reason: "done" }),
      fieldsLine("chain.complete", { outcome: "success", steps_completed: "2" }),
    ];
    const result = renderChainLines(lines);
    expect(result).toContain("# Chain State");
    expect(result).toContain("## Chain: full");
    expect(result).toContain("Step 1 (test) started");
    expect(result).toContain("Step 2 (deploy) finished: done");
    expect(result).toContain("Outcome: success");
  });

  it("ignores non-chain topics mixed in", () => {
    const lines = [
      fieldsLine("chain.start", { name: "mixed", steps: "1" }),
      fieldsLine("iteration.start", {}),
      fieldsLine("task.complete", {}),
      fieldsLine("chain.complete", { outcome: "done", steps_completed: "1" }),
    ];
    const result = renderChainLines(lines);
    expect(result).not.toContain("iteration.start");
    expect(result).not.toContain("task.complete");
    expect(result).toContain("## Chain: mixed");
    expect(result).toContain("Outcome: done");
  });
});
