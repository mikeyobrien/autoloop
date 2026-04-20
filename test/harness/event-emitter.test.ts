import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.3 — verify that RunOptions.onEvent receives structured LoopEvents
 * alongside the existing stderr/stdout output (no behavior change).
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

vi.mock("../../src/harness/display.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    printSummary: vi.fn(),
    printProjectedMarkdown: vi.fn(),
    printProjectedText: vi.fn(),
  };
});

vi.mock("../../src/registry/harness.js", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
}));

import type { LoopEvent } from "../../src/harness/events.js";
import { run } from "../../src/harness/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-events-test-"));
  writeFileSync(join(dir, "autoloops.toml"), '[backend]\ncommand = "echo"\n');
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
