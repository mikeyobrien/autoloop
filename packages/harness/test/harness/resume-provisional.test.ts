import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  extractField,
  extractIteration,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { resume } from "@mobrienv/autoloop-harness";
import {
  type DanglingProvisional,
  resolveOrphanedProvisional,
} from "@mobrienv/autoloop-harness/provisional";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../src/metareview.js", () => ({
  maybeRunMetareview: vi.fn((loop: unknown) => loop),
}));

vi.mock("../../src/display.js", () => ({
  printSummary: vi.fn(),
  log: vi.fn(),
  runCostUsd: vi.fn(() => 0),
  lastNChars: vi.fn((s: string, n?: number) =>
    n === undefined ? s : s.slice(-n),
  ),
  printProjectedMarkdown: vi.fn(),
  printProjectedText: vi.fn(),
  printHookOutput: vi.fn(),
}));

vi.mock("../../src/registry-bridge.js", () => ({
  registryStart: vi.fn(),
  registryStop: vi.fn(),
  registryComplete: vi.fn(),
  registryProgress: vi.fn(),
}));

const RUN = "run-provisional-resume";
const CRASH_ITERATION = 3;

function makeProject(verifyCommands: string[] = ["true"]): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-resume-provisional-"));
  const quotedCommands = verifyCommands
    .map((command) => JSON.stringify(command))
    .join(", ");
  writeFileSync(
    join(dir, "autoloops.toml"),
    [
      '[backend]\ncommand = "true"',
      "[event_loop]",
      `max_iterations = ${CRASH_ITERATION}`,
      "[acceptance]",
      `verify_cmds = [${quotedCommands}]`,
      "[review]",
      "enabled = false",
    ].join("\n"),
  );
  writeFileSync(join(dir, "topology.toml"), '[[role]]\nname = "builder"\n');
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

function recordFor(dir: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: RUN,
    status: "running",
    preset: "test",
    objective: "recover the completion claim",
    trigger: "cli",
    project_dir: dir,
    work_dir: dir,
    state_dir: join(dir, ".autoloop"),
    journal_file: join(dir, ".autoloop", "journal.jsonl"),
    parent_run_id: "",
    backend: "true",
    backend_args: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    iteration: CRASH_ITERATION,
    max_iterations: CRASH_ITERATION,
    stop_reason: "interrupted",
    latest_event: "completion.provisional",
    isolation_mode: "run-scoped",
    worktree_name: "",
    worktree_path: "",
    // A running record whose process is gone is the durable kill -9 artifact.
    pid: 2_147_483_647,
    ...overrides,
  };
}

function appendFinish(dir: string, iteration = CRASH_ITERATION): void {
  appendEvent(
    join(dir, ".autoloop", "journal.jsonl"),
    RUN,
    String(iteration),
    "iteration.finish",
    '"exit_code": "0", "output": "done claim"',
  );
}

function appendProvisional(
  dir: string,
  iteration = CRASH_ITERATION,
  reason = "completion_event",
): void {
  appendEvent(
    join(dir, ".autoloop", "journal.jsonl"),
    RUN,
    String(iteration),
    "completion.provisional",
    `"state": "awaiting_acceptance", "reason": "${reason}"`,
  );
}

function appendResolution(
  dir: string,
  topic: "completion.accepted" | "completion.held",
  iteration = CRASH_ITERATION,
): void {
  appendEvent(
    join(dir, ".autoloop", "journal.jsonl"),
    RUN,
    String(iteration),
    topic,
    topic === "completion.accepted"
      ? '"state": "accepted", "human_ack": false'
      : '"state": "held", "cause": "acceptance"',
  );
}

function journalLines(dir: string): string[] {
  return readRunLines(join(dir, ".autoloop", "journal.jsonl"), RUN);
}

function topicIndex(
  lines: string[],
  topic: string,
  iteration?: number,
): number {
  return lines.findIndex(
    (line) =>
      extractTopic(line) === topic &&
      (iteration === undefined || extractIteration(line) === String(iteration)),
  );
}

describe("resume orphaned provisional completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-runs passing gates and accepts before starting any new iteration", async () => {
    const dir = makeProject(["printf resumed > gate-ran", "true"]);
    appendFinish(dir);
    appendProvisional(dir);

    const result = await resume(recordFor(dir), { addIterations: 1 });
    const lines = journalLines(dir);
    const accepted = topicIndex(lines, "completion.accepted", CRASH_ITERATION);

    expect(readFileSync(join(dir, "gate-ran"), "utf-8")).toBe("resumed");
    expect(accepted).toBeGreaterThan(
      topicIndex(lines, "completion.provisional", CRASH_ITERATION),
    );
    expect(topicIndex(lines, "iteration.start", CRASH_ITERATION + 1)).toBe(-1);
    expect(topicIndex(lines, "iteration.finish", CRASH_ITERATION + 1)).toBe(-1);
    expect(result).toMatchObject({
      iterations: CRASH_ITERATION,
      stopReason: "completion_event",
      resumedFromIteration: CRASH_ITERATION + 1,
    });
  });

  it("holds failing gates before resuming rework at the next iteration", async () => {
    const dir = makeProject(["printf resumed > gate-ran", "false"]);
    appendFinish(dir);
    appendProvisional(dir);

    const result = await resume(recordFor(dir), { addIterations: 1 });
    const lines = journalLines(dir);
    const held = topicIndex(lines, "completion.held", CRASH_ITERATION);
    const newStart = topicIndex(lines, "iteration.start", CRASH_ITERATION + 1);

    expect(readFileSync(join(dir, "gate-ran"), "utf-8")).toBe("resumed");
    expect(held).toBeGreaterThan(
      topicIndex(lines, "completion.provisional", CRASH_ITERATION),
    );
    expect(newStart).toBeGreaterThan(held);
    expect(
      topicIndex(lines, "iteration.finish", CRASH_ITERATION + 1),
    ).toBeGreaterThan(newStart);
    expect(result.resumedFromIteration).toBe(CRASH_ITERATION + 1);
    expect(result.newMaxIterations).toBe(CRASH_ITERATION + 1);
    // Fresh iteration termination is environment-sensitive under fork pressure.
    expect(result.stopReason).not.toBe("completion_event");
    expect(topicIndex(lines, "completion.accepted", CRASH_ITERATION)).toBe(-1);
  });

  it("does not re-run gates for an already accepted completion history", async () => {
    const dir = makeProject(["printf should-not-run > gate-reran", "false"]);
    appendFinish(dir);
    appendProvisional(dir);
    appendResolution(dir, "completion.accepted");

    const result = await resume(
      recordFor(dir, {
        status: "stopped",
        stop_reason: "completed",
        latest_event: "loop.complete",
      }),
      { addIterations: 1 },
    );
    const lines = journalLines(dir);

    expect(existsSync(join(dir, "gate-reran"))).toBe(false);
    expect(
      topicIndex(lines, "iteration.start", CRASH_ITERATION + 1),
    ).toBeGreaterThan(
      topicIndex(lines, "completion.accepted", CRASH_ITERATION),
    );
    expect(result.resumedFromIteration).toBe(CRASH_ITERATION + 1);
  });

  it.each([
    { stopReason: "max_iterations", finish: true, expected: 4 },
    { stopReason: "interrupted", finish: true, expected: 4 },
    { stopReason: "interrupted", finish: false, expected: 3 },
  ])("preserves $stopReason resume behavior without a provisional claim", async ({
    stopReason,
    finish,
    expected,
  }) => {
    const dir = makeProject();
    if (finish) appendFinish(dir);

    const result = await resume(
      recordFor(dir, {
        status: "stopped",
        stop_reason: stopReason,
        latest_event: finish ? "iteration.finish" : "iteration.start",
      }),
      { addIterations: 1 },
    );
    const lines = journalLines(dir);

    expect(result.resumedFromIteration).toBe(expected);
    expect(topicIndex(lines, "iteration.start", expected)).toBeGreaterThan(-1);
    expect(
      lines.some((line) => extractTopic(line).startsWith("completion.")),
    ).toBe(false);
  });
});

function orphanLoop(workDir: string): LoopContext {
  const stateDir = mkdtempSync(join(tmpdir(), "autoloop-orphan-unit-"));
  const journalFile = join(stateDir, "journal.jsonl");
  return {
    paths: { workDir, stateDir, journalFile },
    runtime: { runId: RUN },
  } as unknown as LoopContext;
}

function heldCause(loop: LoopContext, iteration: number): string {
  const held = readRunLines(loop.paths.journalFile, RUN).find(
    (line) =>
      extractTopic(line) === "completion.held" &&
      extractIteration(line) === String(iteration),
  );
  expect(held).toBeDefined();
  return extractField(held as string, "cause");
}

describe("resolveOrphanedProvisional fail-closed paths", () => {
  const dangling: DanglingProvisional = {
    iteration: CRASH_ITERATION,
    reason: "completion_event",
  };

  it("holds with an orphaned-crash cause when gate re-entry throws", () => {
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-orphan-work-"));
    const loop = orphanLoop(workDir);
    const resolver = vi.fn(() => {
      throw new Error("verify process unavailable");
    });

    expect(
      resolveOrphanedProvisional(loop, dangling, {
        registryIteration: CRASH_ITERATION,
        resolver,
      }),
    ).toBe("held");
    expect(resolver).toHaveBeenCalledOnce();
    expect(heldCause(loop, CRASH_ITERATION)).toMatch(
      /^orphaned_crash: completion gates could not be re-run/,
    );
  });

  it("holds without invoking gates when the work directory is unavailable", () => {
    const loop = orphanLoop(join(tmpdir(), `missing-work-${Date.now()}`));
    const resolver = vi.fn();

    expect(
      resolveOrphanedProvisional(loop, dangling, {
        registryIteration: CRASH_ITERATION,
        resolver,
      }),
    ).toBe("held");
    expect(resolver).not.toHaveBeenCalled();
    expect(heldCause(loop, CRASH_ITERATION)).toMatch(
      /^orphaned_crash: work directory is unavailable/,
    );
  });

  it("holds a stale claim without invoking gates or completing it", () => {
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-orphan-work-"));
    const loop = orphanLoop(workDir);
    const resolver = vi.fn();

    expect(
      resolveOrphanedProvisional(loop, dangling, {
        registryIteration: CRASH_ITERATION + 1,
        resolver,
      }),
    ).toBe("held");
    expect(resolver).not.toHaveBeenCalled();
    expect(heldCause(loop, CRASH_ITERATION)).toMatch(
      /^orphaned_crash: stale provisional/,
    );
    expect(
      readRunLines(loop.paths.journalFile, RUN).some(
        (line) => extractTopic(line) === "loop.complete",
      ),
    ).toBe(false);
  });
});
