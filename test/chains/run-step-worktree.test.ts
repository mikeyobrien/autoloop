import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verify that planning-category chain steps (e.g. automerge) do NOT
 * inherit worktree isolation from the parent chain run.
 * Per RFC: "The automerge preset must run in the main tree."
 */

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

vi.mock("@mobrienv/autoloop-harness", () => ({
  run: vi.fn(() => ({ stopReason: "completion_event", iterations: 1 })),
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
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

import * as harness from "@mobrienv/autoloop-harness";
import { runChain } from "../../src/chains/run.js";
import type { ChainSpec } from "../../src/chains/types.js";

describe("runChain worktree suppression for planning steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suppresses worktree flag for planning-category steps", async () => {
    const spec: ChainSpec = {
      name: "test-chain",
      steps: [
        { name: "autocode", presetDir: "/presets/autocode" },
        { name: "automerge", presetDir: "/presets/automerge" },
      ],
    };

    await runChain(spec, ".", "autoloop", { worktree: true });

    const calls = vi.mocked(harness.run).mock.calls;
    expect(calls).toHaveLength(2);

    // First step (autocode = "code" category) should keep worktree: true
    const step1Options = calls[0][3];
    expect(step1Options.worktree).toBe(true);
    expect(step1Options.noWorktree).toBeUndefined();

    // Second step (automerge = "planning" category) should have worktree suppressed
    const step2Options = calls[1][3];
    expect(step2Options.worktree).toBeUndefined();
    expect(step2Options.noWorktree).toBe(true);
  });

  it("does not suppress worktree when worktree is not requested", async () => {
    const spec: ChainSpec = {
      name: "test-chain",
      steps: [{ name: "automerge", presetDir: "/presets/automerge" }],
    };

    await runChain(spec, ".", "autoloop", {});

    const calls = vi.mocked(harness.run).mock.calls;
    expect(calls).toHaveLength(1);

    // No worktree requested, so no suppression needed
    const stepOptions = calls[0][3];
    expect(stepOptions.worktree).toBeUndefined();
    expect(stepOptions.noWorktree).toBeUndefined();
  });
});
