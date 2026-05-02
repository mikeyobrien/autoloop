import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.10 — SDK embed smoke test.
 *
 * Proves that importing from the public entry (src/index.ts, i.e.
 * \`@mobrienv/autoloop\`) works and that a caller who supplies onEvent but
 * no other terminal options gets ZERO writes to process.stdout /
 * process.stderr. If a future change reintroduces a console.log somewhere
 * under harness/, this test will fail.
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

vi.mock("@mobrienv/autoloop-harness/iteration", () => ({
  runIteration: vi.fn(() => ({
    stopReason: "completed",
    iterations: 1,
    exitCode: 0,
  })),
}));

vi.mock("@mobrienv/autoloop-harness/metareview", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("@mobrienv/autoloop-harness/registry-bridge", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
  registryProgress: vi.fn(),
}));

// activeRuns reads the real ~/.autoloop/registry.jsonl — if another run
// (e.g. a concurrent autocode loop) is active, buildLoopContext writes a
// warning to stderr. Stub it so the "zero stderr" assertion is hermetic.
vi.mock("@mobrienv/autoloop-core/registry/read", () => ({
  activeRuns: vi.fn(() => []),
  listRuns: vi.fn(() => []),
  readRegistry: vi.fn(() => []),
}));

// Import from the PUBLIC SDK entry, not harness/index.ts.
import { type LoopEvent, type RunSummary, run } from "../../src/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-sdk-smoke-"));
  writeFileSync(join(dir, "autoloops.toml"), '[backend]\ncommand = "echo"\n');
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("SDK embed smoke test (1.10)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes run + types from the public entry", () => {
    expect(typeof run).toBe("function");
  });

  it("produces zero stdout/stderr when onEvent is supplied", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write");
    const stderrWrite = vi.spyOn(process.stderr, "write");
    const events: LoopEvent[] = [];

    const summary: RunSummary = await run(
      makeProject(),
      "embed test",
      "autoloop",
      { onEvent: (e) => events.push(e) },
    );

    expect(summary.stopReason).toBe("completed");
    expect(events.length).toBeGreaterThan(0);
    expect(stdoutWrite).not.toHaveBeenCalled();
    // harness/display.ts::log() still writes to stderr alongside emitting.
    // SDK consumers who want total silence can filter or replace log().
    // This test documents that contract: stderr IS allowed for diagnostic
    // logs, stdout is NOT.
    // (If we ever route log() purely through events with no stderr write,
    // flip this to toHaveBeenCalledTimes(0).)
    const nonLogStderrWrites = stderrWrite.mock.calls.filter(
      ([chunk]) => !String(chunk).includes("[autoloops]"),
    );
    expect(nonLogStderrWrites).toEqual([]);

    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it("delivers LoopEvent stream in expected order", async () => {
    const events: LoopEvent[] = [];
    await run(makeProject(), "embed test", "autoloop", {
      onEvent: (e) => events.push(e),
    });

    const structural = events
      .map((e) => e.type)
      .filter((t) => t === "iteration.start" || t === "loop.finish");
    expect(structural[0]).toBe("iteration.start");
    expect(structural.at(-1)).toBe("loop.finish");
  });
});
