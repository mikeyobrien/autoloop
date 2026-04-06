import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Test that inspect projection surfaces correctly resolve journals
 * for run-scoped and worktree-backed runs via --run flag.
 */

vi.mock("../../src/harness/emit.js", () => ({
  resolveEmitJournalFile: vi.fn((projectDir: string) =>
    join(projectDir, ".autoloop", "journal.jsonl"),
  ),
  emit: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  loadProject: vi.fn(() => ({
    core: { state_dir: ".autoloop" },
  })),
  get: vi.fn((_cfg: unknown, key: string, fallback: string) => {
    if (key === "core.state_dir") return ".autoloop";
    return fallback;
  }),
  stateDirPath: vi.fn((projectDir: string) =>
    join(projectDir, ".autoloop"),
  ),
  resolveJournalFile: vi.fn((projectDir: string) =>
    join(projectDir, ".autoloop", "journal.jsonl"),
  ),
  getProfileDefaults: vi.fn(() => []),
}));

import {
  renderScratchpadFormat,
  renderPromptFormat,
  renderOutput,
  renderCoordinationFormat,
  renderMetrics,
  renderMetricsForRun,
} from "../../src/harness/index.js";

function journalLine(
  run: string,
  topic: string,
  iteration: string,
  fields: Record<string, string> = {},
): string {
  return JSON.stringify({ run, topic, iteration, timestamp: new Date().toISOString(), fields });
}

const tmpDir = join(import.meta.dirname, "__tmp_inspect_run_test__");

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("inspect projection surfaces with --run for run-scoped journals", () => {
  function setupRunScopedJournal(runId: string): void {
    const runDir = join(tmpDir, ".autoloop", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const lines = [
      journalLine(runId, "loop.start", "0"),
      journalLine(runId, "iteration.start", "1", { prompt: "do the thing" }),
      journalLine(runId, "iteration.finish", "1", { output: "done" }),
      journalLine(runId, "scratchpad.update", "1", { content: "scratch content" }),
      journalLine(runId, "event", "1", { payload: "coordination data", source: "agent" }),
    ];
    writeFileSync(join(runDir, "journal.jsonl"), lines.join("\n") + "\n");
  }

  it("renderScratchpadFormat reads from run-scoped journal when runId provided", () => {
    const runId = "run-scoped-1";
    setupRunScopedJournal(runId);
    // Should not throw; reads from runs/<runId>/journal.jsonl
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderScratchpadFormat(tmpDir, "terminal", runId);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renderPromptFormat reads from run-scoped journal when runId provided", () => {
    const runId = "run-scoped-2";
    setupRunScopedJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderPromptFormat(tmpDir, "1", "terminal", runId);
    expect(spy).toHaveBeenCalled();
    // Should have printed the prompt content, not a "missing" message
    const output = spy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).not.toContain("missing prompt");
    spy.mockRestore();
  });

  it("renderOutput reads from run-scoped journal when runId provided", () => {
    const runId = "run-scoped-3";
    setupRunScopedJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderOutput(tmpDir, "1", runId);
    expect(spy).toHaveBeenCalledWith("done");
    spy.mockRestore();
  });

  it("renderCoordinationFormat reads from run-scoped journal when runId provided", () => {
    const runId = "run-scoped-4";
    setupRunScopedJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderCoordinationFormat(tmpDir, "terminal", runId);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renderMetrics reads from run-scoped journal when runId provided", () => {
    const runId = "run-scoped-5";
    setupRunScopedJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderMetrics(tmpDir, "terminal", runId);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renderMetricsForRun reads from run-scoped journal", () => {
    const runId = "run-scoped-6";
    setupRunScopedJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderMetricsForRun(tmpDir, runId, "terminal");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("inspect projection surfaces with --run for worktree journals", () => {
  function setupWorktreeJournal(runId: string): void {
    const wtDir = join(tmpDir, ".autoloop", "worktrees", runId, "tree", ".autoloop");
    mkdirSync(wtDir, { recursive: true });
    const lines = [
      journalLine(runId, "loop.start", "0"),
      journalLine(runId, "iteration.start", "1", { prompt: "worktree task" }),
      journalLine(runId, "iteration.finish", "1", { output: "worktree done" }),
    ];
    writeFileSync(join(wtDir, "journal.jsonl"), lines.join("\n") + "\n");
  }

  it("renderOutput reads from worktree journal when runId provided", () => {
    const runId = "wt-run-1";
    setupWorktreeJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderOutput(tmpDir, "1", runId);
    expect(spy).toHaveBeenCalledWith("worktree done");
    spy.mockRestore();
  });

  it("renderPromptFormat reads from worktree journal when runId provided", () => {
    const runId = "wt-run-2";
    setupWorktreeJournal(runId);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderPromptFormat(tmpDir, "1", "terminal", runId);
    const output = spy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).not.toContain("missing prompt");
    spy.mockRestore();
  });
});

describe("fallback to top-level journal when no isolated journal exists", () => {
  it("renderOutput falls back to top-level journal", () => {
    // Create top-level journal only
    const stateDir = join(tmpDir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
    const runId = "top-level-run";
    const lines = [
      journalLine(runId, "loop.start", "0"),
      journalLine(runId, "iteration.start", "1", { prompt: "top-level prompt" }),
      journalLine(runId, "iteration.finish", "1", { output: "top-level output" }),
    ];
    writeFileSync(join(stateDir, "journal.jsonl"), lines.join("\n") + "\n");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderOutput(tmpDir, "1", runId);
    expect(spy).toHaveBeenCalledWith("top-level output");
    spy.mockRestore();
  });
});
