import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loop-scoped wall-clock budget (event_loop.max_runtime): the between-
 * iteration guard is journal-derived (loop.start created_at), so it covers
 * every continue path. With a 1ms budget the guard must trip at the
 * iteration-2 check and journal a max_runtime stop.
 */

vi.mock("@mobrienv/autoloop-core/worktree", () => ({
  mergeWorktree: vi.fn(),
  updateStatus: vi.fn(),
  readMeta: vi.fn(() => null),
  metaDirForRun: vi.fn(() => "/tmp/fake-meta"),
  writeMeta: vi.fn(),
  isOrphanWorktree: vi.fn(() => false),
  createWorktree: vi.fn(() => ({
    worktreePath: "/tmp/fake-worktree",
    branch: "autoloop/fake-run",
    metaDir: "/tmp/fake-meta",
  })),
  resolveGitRoot: vi.fn((cwd: string) => cwd),
  tryResolveGitRoot: vi.fn((cwd: string) => cwd),
  cleanWorktrees: vi.fn(),
  listWorktreeMetas: vi.fn(() => []),
}));

const runIteration = vi.hoisted(() =>
  vi.fn((_loop: unknown, _iter: number, _recurse: unknown) => ({
    stopReason: "completed",
    iterations: 1,
    exitCode: 0,
  })),
);
vi.mock("../../src/iteration.js", () => ({ runIteration }));

vi.mock("../../src/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("../../src/display.js", () => ({
  printSummary: vi.fn(),
  log: vi.fn(),
  runCostUsd: vi.fn(() => 0),
  lastNChars: vi.fn((s: string) => s),
  printProjectedMarkdown: vi.fn(),
  printProjectedText: vi.fn(),
}));

const registryStop = vi.hoisted(() => vi.fn());
vi.mock("../../src/registry-bridge.js", () => ({
  registryStart: vi.fn(),
  registryStop,
  registryComplete: vi.fn(),
  registryProgress: vi.fn(),
}));

import { run } from "@mobrienv/autoloop-harness";

function makeProject(configToml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-runtime-budget-"));
  writeFileSync(join(dir, "autoloops.toml"), configToml);
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("harness.run max_runtime guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops with reason max_runtime once the budget is exhausted", async () => {
    const projectDir = makeProject(
      [
        '[backend]\ncommand = "echo"',
        "[event_loop]",
        "max_iterations = 5",
        'max_runtime = "1"',
      ].join("\n"),
    );
    // Iteration 1 completes and recurses; the iteration-2 guard must trip.
    runIteration.mockImplementationOnce(
      (loop: unknown, _iter: number, recurse: unknown) =>
        (recurse as (l: unknown, i: number) => unknown)(loop, 2),
    );

    const summary = await run(projectDir, "prompt", "autoloop", {
      workDir: projectDir,
    });

    expect(summary.stopReason).toBe("max_runtime");
    expect(summary.iterations).toBe(1);
    expect(runIteration).toHaveBeenCalledTimes(1);
    expect(registryStop).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "max_runtime",
    );
    const journal = readFileSync(
      join(projectDir, ".autoloop", "journal.jsonl"),
      "utf-8",
    );
    expect(journal).toContain('"topic": "loop.stop"');
    expect(journal).toContain('"reason": "max_runtime"');
    expect(journal).toContain('"completed_iterations": "1"');
    expect(journal).toContain('"max_runtime_ms": "1"');
  });

  it("does not trip when max_runtime is disabled", async () => {
    const projectDir = makeProject(
      [
        '[backend]\ncommand = "echo"',
        "[event_loop]",
        "max_iterations = 5",
      ].join("\n"),
    );
    runIteration.mockImplementationOnce(
      (loop: unknown, _iter: number, recurse: unknown) =>
        (recurse as (l: unknown, i: number) => unknown)(loop, 2),
    );

    const summary = await run(projectDir, "prompt", "autoloop", {
      workDir: projectDir,
    });

    expect(summary.stopReason).toBe("completed");
    expect(runIteration).toHaveBeenCalledTimes(2);
  });
});
