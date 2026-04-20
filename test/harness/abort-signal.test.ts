import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.2 — verify the AbortSignal → graceful-teardown path in harness.run().
 *
 * Before 1.2 the harness installed its own process.on("SIGINT"/"SIGTERM")
 * handlers. Now the CLI owns signal handling and hands the harness an
 * AbortSignal. These tests prove the harness:
 *   - returns with stopReason="interrupted" when the signal is pre-aborted
 *   - tears down cleanly when aborted mid-run (no further iterations)
 */

vi.mock("../../src/worktree/merge.js", () => ({ mergeWorktree: vi.fn() }));
vi.mock("../../src/worktree/meta.js", () => ({
  updateStatus: vi.fn(),
  readMeta: vi.fn(() => null),
  metaDirForRun: vi.fn(() => "/tmp/fake-meta"),
  writeMeta: vi.fn(),
  isOrphanWorktree: vi.fn(() => false),
}));
vi.mock("../../src/worktree/create.js", () => ({
  createWorktree: vi.fn(() => ({
    worktreePath: "/tmp/fake-worktree",
    branch: "autoloop/fake-run",
    metaDir: "/tmp/fake-meta",
  })),
  resolveGitRoot: vi.fn((cwd: string) => cwd),
  tryResolveGitRoot: vi.fn((cwd: string) => cwd),
}));
vi.mock("../../src/worktree/clean.js", () => ({ cleanWorktrees: vi.fn() }));

const runIteration = vi.hoisted(() =>
  vi.fn((_loop: unknown, _iter: number, _recurse: unknown) => ({
    stopReason: "completed",
    iterations: 1,
    exitCode: 0,
  })),
);
vi.mock("../../src/harness/iteration.js", () => ({ runIteration }));

vi.mock("../../src/harness/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("../../src/harness/display.js", () => ({
  printSummary: vi.fn(),
  log: vi.fn(),
  printProjectedMarkdown: vi.fn(),
  printProjectedText: vi.fn(),
}));

const registryStop = vi.hoisted(() => vi.fn());
vi.mock("../../src/registry/harness.js", () => ({
  registryStart: vi.fn(),
  registryStop,
}));

import { run } from "../../src/harness/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-abort-test-"));
  writeFileSync(join(dir, "autoloops.toml"), '[backend]\ncommand = "echo"\n');
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("harness.run abort signal (1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stopReason=interrupted with a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const summary = await run(makeProject(), "prompt", "autoloop", {
      signal: controller.signal,
    });
    expect(summary.stopReason).toBe("interrupted");
    expect(summary.iterations).toBe(0);
    expect(runIteration).not.toHaveBeenCalled();
  });

  it("tears down via registryStop when the signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await run(makeProject(), "prompt", "autoloop", {
      signal: controller.signal,
    });
    expect(registryStop).toHaveBeenCalledWith(
      expect.anything(),
      0,
      "interrupted",
    );
  });

  it("runs to completion when no signal is provided", async () => {
    const summary = await run(makeProject(), "prompt", "autoloop", {});
    expect(summary.stopReason).toBe("completed");
    expect(runIteration).toHaveBeenCalled();
  });

  it("stops further iterations if aborted mid-run", async () => {
    const controller = new AbortController();
    // First iteration: completes normally, then aborts before the 2nd.
    runIteration.mockImplementationOnce(
      (_loop: unknown, _iter: number, recurse: unknown) => {
        controller.abort();
        return (recurse as (l: unknown, i: number) => unknown)(_loop, 2);
      },
    );
    runIteration.mockImplementation(() => ({
      stopReason: "completed",
      iterations: 1,
      exitCode: 0,
    }));
    const summary = await run(makeProject(), "prompt", "autoloop", {
      signal: controller.signal,
    });
    expect(summary.stopReason).toBe("interrupted");
    // runIteration called exactly once (for iter=1); iter=2 short-circuits.
    expect(runIteration).toHaveBeenCalledTimes(1);
  });
});
