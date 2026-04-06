import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Verify that runInlineChain forwards worktree-related options
 * to chains.runChain (Slice 2 of the isolation RFC).
 *
 * We mock the chains module so no real runs happen.
 */

// Mock chains before importing the module under test
vi.mock("../../src/chains.js", () => ({
  parseInlineChain: vi.fn((_csv: string, _dir: string) => ({
    name: "inline",
    steps: [{ name: "autocode" }, { name: "autoqa" }],
  })),
  validatePresetVocabulary: vi.fn(() => ({ ok: true })),
  runChain: vi.fn(() => ({ completed: [], outcome: "ok" })),
  listKnownPresets: vi.fn(() => ["autocode", "autoqa"]),
}));

// Also mock harness.run to prevent side effects from the non-chain path
vi.mock("../../src/harness/index.js", () => ({
  run: vi.fn(),
}));

import { dispatchRun } from "../../src/commands/run.js";
import * as chains from "../../src/chains.js";

describe("runInlineChain option propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards worktree options through to chains.runChain", () => {
    // dispatch with --chain and worktree options
    dispatchRun(
      ["--chain", "autocode,autoqa", "--worktree", "--merge-strategy", "rebase", "--keep-worktree", "."],
      [],
      ".",
      "autoloop",
    );

    expect(chains.runChain).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chains.runChain).mock.calls[0];
    const runOptions = callArgs[3];

    expect(runOptions.worktree).toBe(true);
    expect(runOptions.mergeStrategy).toBe("rebase");
    expect(runOptions.keepWorktree).toBe(true);
  });

  it("forwards automerge option through to chains.runChain", () => {
    dispatchRun(
      ["--chain", "autocode,autoqa", "--automerge", "."],
      [],
      ".",
      "autoloop",
    );

    expect(chains.runChain).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chains.runChain).mock.calls[0];
    const runOptions = callArgs[3];

    expect(runOptions.automerge).toBe(true);
  });

  it("forwards --no-worktree through to chains.runChain", () => {
    dispatchRun(
      ["--chain", "autocode,autoqa", "--no-worktree", "."],
      [],
      ".",
      "autoloop",
    );

    expect(chains.runChain).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chains.runChain).mock.calls[0];
    const runOptions = callArgs[3];

    expect(runOptions.noWorktree).toBe(true);
  });
});
