import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify root budget enforcement in runChain: maxSteps is checked before
 * executing, and maxRuntimeMs stops the chain between steps. Budget stops
 * are journaled via chain.complete with a budget_exceeded outcome.
 */

let journalLines: string[] = [];

vi.mock("@mobrienv/autoloop-core/config", () => ({
  loadProject: vi.fn(() => ({})),
  get: vi.fn(() => "compact"),
  stateDirPath: vi.fn(() => "/tmp/test-chain-budget-state"),
  resolveJournalFile: vi.fn(() => "/tmp/test-chain-budget-journal"),
  resolveProjectDir: vi.fn((_name: string) => null),
  projectHasConfig: vi.fn(() => false),
}));

vi.mock("@mobrienv/autoloop-core/journal", () => ({
  appendText: vi.fn((_file: string, line: string) => {
    journalLines.push(line);
  }),
  readLines: vi.fn(() => []),
  extractTopic: vi.fn(() => ""),
  extractField: vi.fn(() => ""),
}));

vi.mock("@mobrienv/autoloop-harness", () => ({
  run: vi.fn(() => ({
    stopReason: "completion_event",
    iterations: 1,
    runId: "run-1",
  })),
}));

vi.mock("@mobrienv/autoloop-core/isolation/resolve", () => ({
  presetCategory: vi.fn(() => "code"),
}));

vi.mock("@mobrienv/autoloop-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-core")>();
  return {
    ...actual,
    generateCompactId: vi.fn(() => "chain-budget-1"),
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

import * as harness from "@mobrienv/autoloop-harness";
import { defaultBudget } from "../../src/chains/budget.js";
import { runChain } from "../../src/chains/run.js";
import type { ChainSpec } from "../../src/chains/types.js";

const twoStepSpec: ChainSpec = {
  name: "budget-chain",
  steps: [
    { name: "autocode", presetDir: "/presets/autocode" },
    { name: "autoqa", presetDir: "/presets/autoqa" },
  ],
};

describe("runChain root budget enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journalLines = [];
  });

  it("runs all steps when the budget permits", async () => {
    const result = await runChain(twoStepSpec, ".", "autoloop", {});
    expect(result.outcome).toBe("all_steps_complete");
    expect(result.completed).toHaveLength(2);
    expect(vi.mocked(harness.run)).toHaveBeenCalledTimes(2);
  });

  it("rejects a chain whose step count exceeds maxSteps before running", async () => {
    const budget = { ...defaultBudget(), maxSteps: 1 };
    const result = await runChain(twoStepSpec, ".", "autoloop", {}, budget);

    expect(result.outcome).toBe("budget_exceeded");
    expect(result.failedReason).toBe(
      "budget_exceeded:max_steps exceeded (2/1)",
    );
    expect(result.completed).toHaveLength(0);
    expect(vi.mocked(harness.run)).not.toHaveBeenCalled();
  });

  it("stops between steps when maxRuntimeMs is exhausted", async () => {
    const budget = { ...defaultBudget(), maxRuntimeMs: 0 };
    const result = await runChain(twoStepSpec, ".", "autoloop", {}, budget);

    expect(result.outcome).toBe("budget_exceeded");
    expect(result.failedStep).toBe(2);
    expect(result.failedReason).toMatch(
      /^budget_exceeded:max_runtime_ms exceeded \(\d+ms\/0ms\)$/,
    );
    expect(result.completed).toHaveLength(1);
    expect(vi.mocked(harness.run)).toHaveBeenCalledTimes(1);
  });

  it("journals budget stops via chain.complete with failed_reason", async () => {
    const budget = { ...defaultBudget(), maxSteps: 1 };
    await runChain(twoStepSpec, ".", "autoloop", {}, budget);

    const complete = journalLines.find((l) => l.includes("chain.complete"));
    expect(complete).toBeDefined();
    expect(complete).toContain('"outcome": "budget_exceeded"');
    expect(complete).toContain(
      '"failed_reason": "budget_exceeded:max_steps exceeded (2/1)"',
    );
    // chain.start is still journaled so the rejection is visible in renders
    expect(journalLines.some((l) => l.includes("chain.start"))).toBe(true);
  });

  it("does not add failed_reason to chain.complete on success", async () => {
    await runChain(twoStepSpec, ".", "autoloop", {});
    const complete = journalLines.find((l) => l.includes("chain.complete"));
    expect(complete).toBeDefined();
    expect(complete).toContain('"outcome": "all_steps_complete"');
    expect(complete).not.toContain("failed_reason");
  });
});
