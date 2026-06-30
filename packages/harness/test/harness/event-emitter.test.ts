import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.3 — verify that RunOptions.onEvent receives structured LoopEvents
 * alongside the existing stderr/stdout output (no behavior change).
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

vi.mock("../../src/display.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    printSummary: vi.fn(),
    printProjectedMarkdown: vi.fn(),
    printProjectedText: vi.fn(),
  };
});

vi.mock("../../src/registry-bridge.js", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
}));

import { run } from "@mobrienv/autoloop-harness";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";

function makeProject(maxIterations?: number): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-events-test-"));
  writeFileSync(
    join(dir, "autoloops.toml"),
    `${maxIterations === undefined ? "" : `[event_loop]\nmax_iterations = ${maxIterations}\n\n`}[backend]\ncommand = "echo"\n`,
  );
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("harness.run onEvent (1.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits iteration.start and loop.finish events", async () => {
    const events: LoopEvent[] = [];
    await run(makeProject(), "prompt", "autoloop", {
      onEvent: (e) => events.push(e),
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("iteration.start");
    expect(types).toContain("loop.finish");
    const finish = events.find((e) => e.type === "loop.finish");
    expect(finish).toMatchObject({ stopReason: "completed", iterations: 1 });
  });

  it("emits a loop.start event with the resolved run parameters", async () => {
    const events: LoopEvent[] = [];
    await run(makeProject(), "build the thing", "autoloop", {
      onEvent: (e) => events.push(e),
    });
    const start = events.find((e) => e.type === "loop.start");
    expect(start).toBeDefined();
    expect(start).toMatchObject({
      type: "loop.start",
      prompt: "build the thing",
      backend: "echo",
      preset: expect.any(String),
      maxIterations: expect.any(Number),
    });
    // runId and workDir are resolved, non-empty strings.
    if (start?.type === "loop.start") {
      expect(start.runId.length).toBeGreaterThan(0);
      expect(start.workDir.length).toBeGreaterThan(0);
    }
    // loop.start must precede the first iteration.start.
    const startIdx = events.findIndex((e) => e.type === "loop.start");
    const iterIdx = events.findIndex((e) => e.type === "iteration.start");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeLessThan(iterIdx);
  });

  it("does not emit iteration.start past max_iterations", async () => {
    runIteration.mockImplementationOnce((_loop, _iter, recurse) =>
      recurse(_loop, 2),
    );

    const events: LoopEvent[] = [];
    await run(makeProject(1), "prompt", "autoloop", {
      onEvent: (e) => events.push(e),
    });

    const starts = events.filter((e) => e.type === "iteration.start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ iteration: 1, maxIterations: 1 });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "iteration.start", iteration: 2 }),
    );
    const finish = events.find((e) => e.type === "loop.finish");
    expect(finish).toMatchObject({
      stopReason: "max_iterations",
      iterations: 1,
    });
  });

  it("emits log events with the message and level", async () => {
    const events: LoopEvent[] = [];
    await run(makeProject(), "prompt", "autoloop", {
      onEvent: (e) => events.push(e),
    });
    const logs = events.filter((e) => e.type === "log");
    expect(logs.length).toBeGreaterThan(0);
    const startLog = logs.find(
      (e) => e.type === "log" && e.message.includes("loop start"),
    );
    expect(startLog).toBeDefined();
  });

  it("does not require onEvent — runs complete without listener", async () => {
    const summary = await run(makeProject(), "prompt", "autoloop", {});
    expect(summary.stopReason).toBe("completed");
  });
});
