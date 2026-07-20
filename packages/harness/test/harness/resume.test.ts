import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration: run a real harness loop to a max_iterations stop (real journal
 * via a mocked iteration runner that writes iteration.finish events), then
 * resume() with --add-iterations. Asserts resume:
 *   (a) continues from the correct iteration and does NOT re-run completed ones
 *   (b) appends a loop.resume event to the journal
 *   (c) applies the additive max_iterations budget
 *
 * The worktree/metareview/display/registry-bridge mocks mirror the
 * runtime-budget and abort-signal templates.
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

// Mocked iteration runner: writes a real iteration.finish event (so the
// journal carries the routing/scratchpad state resume reads) then recurses.
// It never emits the completion event, so the loop runs to max_iterations.
const runIteration = vi.hoisted(() =>
  vi.fn(
    (
      loop: {
        paths: { journalFile: string };
        runtime: { runId: string };
      },
      iter: number,
      recurse: (l: unknown, i: number) => unknown,
    ) => {
      appendEvent(
        loop.paths.journalFile,
        loop.runtime.runId,
        String(iter),
        "iteration.finish",
        `"exit_code": "0", "output": "iter ${iter} output"`,
      );
      return recurse(loop, iter + 1);
    },
  ),
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

vi.mock("../../src/registry-bridge.js", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
  registryComplete: vi.fn(),
  registryProgress: vi.fn(),
}));

import { buildResumeContext, resume, run } from "@mobrienv/autoloop-harness";

function makeProject(maxIterations: number): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-resume-"));
  writeFileSync(
    join(dir, "autoloops.toml"),
    [
      '[backend]\ncommand = "echo"',
      "[event_loop]",
      `max_iterations = ${maxIterations}`,
      "[review]",
      "enabled = false",
    ].join("\n"),
  );
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

function recordFor(dir: string): RunRecord {
  return {
    run_id: "run-resume-test",
    status: "stopped",
    preset: "test",
    objective: "do the thing",
    trigger: "cli",
    project_dir: dir,
    work_dir: dir,
    state_dir: join(dir, ".autoloop"),
    journal_file: join(dir, ".autoloop", "journal.jsonl"),
    parent_run_id: "",
    backend: "echo",
    backend_args: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    iteration: 3,
    max_iterations: 3,
    stop_reason: "max_iterations",
    latest_event: "loop.stop",
    isolation_mode: "run-scoped",
    worktree_name: "",
    worktree_path: "",
  };
}

describe("harness.resume integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the original loop to max_iterations, then resume continues from the right iteration", async () => {
    const dir = makeProject(3);

    // 1) Original run: 3 iterations, no completion → max_iterations stop.
    const first = await run(dir, "prompt", "autoloop", { workDir: dir });
    expect(first.stopReason).toBe("max_iterations");
    expect(first.iterations).toBe(3);
    expect(runIteration).toHaveBeenCalledTimes(3);
    // Iterations ran with 1, 2, 3 — never beyond.
    const firstIters = runIteration.mock.calls.map((c) => c[1]);
    expect(firstIters).toEqual([1, 2, 3]);

    runIteration.mockClear();

    // 2) Resume with --add-iterations 2. Registry recorded iteration=3 from
    //    a max_iterations stop → resume at iteration 4, new budget 3 + 2 = 5.
    const record = recordFor(dir);
    const result = await resume(record, { addIterations: 2 });

    expect(result.resumedFromIteration).toBe(4);
    expect(result.newMaxIterations).toBe(5);
    expect(result.stopReason).toBe("max_iterations");

    // (a) Resume re-entered at iteration 4 and did NOT re-run 1..3.
    const resumeIters = runIteration.mock.calls.map((c) => c[1]);
    expect(resumeIters[0]).toBe(4);
    expect(resumeIters).toEqual([4, 5]);
    expect(resumeIters).not.toContain(1);
    expect(resumeIters).not.toContain(2);
    expect(resumeIters).not.toContain(3);

    const journal = readFileSync(
      join(dir, ".autoloop", "journal.jsonl"),
      "utf-8",
    );

    // (b) A loop.resume event was appended with the expected fields.
    expect(journal).toContain('"topic": "loop.resume"');
    expect(journal).toContain('"resumed_from_iteration": "4"');
    expect(journal).toContain('"previous_stop_reason": "max_iterations"');
    expect(journal).toContain('"add_iterations": "2"');
    expect(journal).toContain('"new_max_iterations": "5"');

    // (c) The journal carries iteration.finish for 1..5 across both segments,
    //     proving completed iterations were preserved and resume appended 4..5.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(journal).toContain(`"iteration": "${n}"`);
    }
  });

  it("preserves explicit journal, memory, and task paths on resume", () => {
    const dir = makeProject(3);
    writeFileSync(
      join(dir, "autoloops.toml"),
      [
        '[backend]\ncommand = "echo"',
        "[event_loop]",
        "max_iterations = 3",
        "[review]",
        "enabled = false",
        "[core]",
        'state_dir = ".ralph/autoloop"',
        'journal_file = ".stores/journal.jsonl"',
        'memory_file = ".stores/memory.jsonl"',
        'tasks_file = ".stores/tasks.jsonl"',
      ].join("\n"),
    );
    const record = {
      ...recordFor(dir),
      state_dir: join(dir, ".ralph", "autoloop", "runs", "run-resume-test"),
      journal_file: join(dir, ".stores", "journal.jsonl"),
    };
    mkdirSync(record.state_dir, { recursive: true });

    const { loop } = buildResumeContext(record);

    expect(loop.paths.journalFile).toBe(join(dir, ".stores", "journal.jsonl"));
    expect(loop.paths.memoryFile).toBe(join(dir, ".stores", "memory.jsonl"));
    expect(loop.paths.tasksFile).toBe(join(dir, ".stores", "tasks.jsonl"));
    expect(loop.paths.baseStateDir).toBe(record.state_dir);
  });

  it("preserves explicit worktree-relative stores on worktree resume", () => {
    const dir = makeProject(3);
    const worktree = join(dir, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(
      join(dir, "autoloops.toml"),
      [
        '[backend]\ncommand = "echo"',
        "[event_loop]",
        "max_iterations = 3",
        "[review]",
        "enabled = false",
        "[core]",
        'state_dir = ".ralph/autoloop"',
        'memory_file = ".stores/memory.jsonl"',
        'tasks_file = ".stores/tasks.jsonl"',
      ].join("\n"),
    );
    const record = {
      ...recordFor(dir),
      isolation_mode: "worktree" as const,
      work_dir: worktree,
      worktree_path: worktree,
      state_dir: join(worktree, ".ralph", "autoloop"),
      journal_file: join(worktree, ".stores", "events.jsonl"),
    };
    mkdirSync(record.state_dir, { recursive: true });

    const { loop } = buildResumeContext(record);

    expect(loop.paths.journalFile).toBe(record.journal_file);
    expect(loop.paths.memoryFile).toBe(
      join(worktree, ".stores", "memory.jsonl"),
    );
    expect(loop.paths.tasksFile).toBe(join(worktree, ".stores", "tasks.jsonl"));
    expect(loop.paths.baseStateDir).toBe(join(dir, ".ralph", "autoloop"));
  });

  it("defaults add-iterations to the run's original max_iterations", async () => {
    const dir = makeProject(3);
    await run(dir, "prompt", "autoloop", { workDir: dir });
    runIteration.mockClear();

    // No addIterations → default to record.max_iterations (3).
    // Resume at 4, new budget = 4 - 1 + 3 = 6.
    const result = await resume(recordFor(dir), {});
    expect(result.resumedFromIteration).toBe(4);
    expect(result.newMaxIterations).toBe(6);
    const resumeIters = runIteration.mock.calls.map((c) => c[1]);
    expect(resumeIters).toEqual([4, 5, 6]);
  });
});
