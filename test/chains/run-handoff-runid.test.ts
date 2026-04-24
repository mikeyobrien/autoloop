import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify that runId flows from RunSummary → StepRecord → handoff artifact
 * so the automerge preset can locate the parent worktree.
 */

let writeFileCalls: Array<[string, string]> = [];

vi.mock("@mobrienv/autoloop-core/config", () => ({
  loadProject: vi.fn(() => ({})),
  get: vi.fn(() => "compact"),
  stateDirPath: vi.fn(() => "/tmp/test-chain-state"),
  resolveJournalFile: vi.fn(() => "/tmp/test-journal"),
  resolveProjectDir: vi.fn((_name: string) => null),
  projectHasConfig: vi.fn(() => false),
}));

vi.mock("@mobrienv/autoloop-core/journal", () => ({
  appendText: vi.fn(),
  readLines: vi.fn(() => []),
  extractTopic: vi.fn(() => ""),
  extractField: vi.fn(() => ""),
}));

let runCallCount = 0;
vi.mock("@mobrienv/autoloop-harness", () => ({
  run: vi.fn(() => {
    runCallCount++;
    return {
      stopReason: "completion_event",
      iterations: 1,
      runId: `run-${runCallCount}`,
    };
  }),
}));

vi.mock("@mobrienv/autoloop-core/isolation/resolve", () => ({
  presetCategory: vi.fn((name: string) => {
    if (name === "automerge") return "planning";
    return "code";
  }),
}));

vi.mock("@mobrienv/autoloop-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-core")>();
  return {
    ...actual,
    generateCompactId: vi.fn(() => "chain-test-1"),
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((path: string, content: string) => {
      writeFileCalls.push([path, content]);
    }),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

import { runChain } from "../../src/chains/run.js";
import type { ChainSpec } from "../../src/chains/types.js";

describe("chain handoff runId propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFileCalls = [];
    runCallCount = 0;
  });

  it("includes runId in StepRecord", async () => {
    const spec: ChainSpec = {
      name: "test-chain",
      steps: [{ name: "autocode", presetDir: "/presets/autocode" }],
    };

    const result = await runChain(spec, ".", "autoloop", {});
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].runId).toBe("run-1");
  });

  it("writes parent_run_id in handoff artifact for second step", async () => {
    const spec: ChainSpec = {
      name: "test-chain",
      steps: [
        { name: "autocode", presetDir: "/presets/autocode" },
        { name: "automerge", presetDir: "/presets/automerge" },
      ],
    };

    await runChain(spec, ".", "autoloop", {});

    // Find the handoff.md written for step 2
    const handoffWrites = writeFileCalls.filter(
      ([path]) => path.includes("step-2") && path.endsWith("handoff.md"),
    );
    expect(handoffWrites).toHaveLength(1);
    const handoffContent = handoffWrites[0][1];
    expect(handoffContent).toContain("parent_run_id: run-1");
    expect(handoffContent).toContain("[run_id=run-1]");
  });

  it("includes runId in result artifact", async () => {
    const spec: ChainSpec = {
      name: "test-chain",
      steps: [{ name: "autocode", presetDir: "/presets/autocode" }],
    };

    await runChain(spec, ".", "autoloop", {});

    const resultWrites = writeFileCalls.filter(
      ([path]) => path.includes("step-1") && path.endsWith("result.md"),
    );
    expect(resultWrites).toHaveLength(1);
    expect(resultWrites[0][1]).toContain("Run ID: run-1");
  });
});
