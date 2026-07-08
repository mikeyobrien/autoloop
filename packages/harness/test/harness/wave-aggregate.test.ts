import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractField,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { writeParallelBranchSummary } from "@mobrienv/autoloop-harness/parallel";
import { buildIterationContext } from "@mobrienv/autoloop-harness/prompt";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { finalizeParallelWave } from "@mobrienv/autoloop-harness/wave/finalize-wave";
import { joinParallelBranches } from "@mobrienv/autoloop-harness/wave/launch-branches";
import type {
  AggregateConfig,
  BranchSpec,
} from "@mobrienv/autoloop-harness/wave/types";
import { describe, expect, it } from "vitest";

function makeLoop(name: string): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-wave-agg-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");

  return {
    objective: "aggregate test",
    topology: {
      name: "t",
      completion: "task.complete",
      roles: [],
      handoff: {},
      handoffKeys: [],
      gates: [],
      stages: [],
    },
    limits: { maxIterations: 5 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: "command",
      provider: "",
      command: "true",
      args: [],
      promptMode: "stdin",
      timeoutMs: 2000,
    },
    review: {
      enabled: false,
      every: 4,
      kind: "command",
      command: "true",
      args: [],
      promptMode: "stdin",
      prompt: "",
      timeoutMs: 1000,
      trustAllTools: false,
      agent: "",
      model: "",
      onError: "hold",
      minConfidence: 0.5,
    },
    parallel: {
      enabled: true,
      maxBranches: 5,
      branchTimeoutMs: 60000,
      aggregate: { mode: "wait_for_all", timeoutMs: 0 },
    },
    memory: { budgetChars: 1000 },
    tasks: { budgetChars: 1000 },
    harness: { instructions: "" },
    profiles: { active: [], fragments: new Map(), warnings: [] },
    paths: {
      projectDir: workDir,
      workDir,
      stateDir,
      journalFile: join(stateDir, "journal.jsonl"),
      memoryFile: join(stateDir, "memory.jsonl"),
      tasksFile: join(stateDir, "tasks.jsonl"),
      registryFile: join(stateDir, "registry.jsonl"),
      toolPath: "/usr/bin/autoloop",
      piAdapterPath: "/usr/local/bin/pi-adapter",
      baseStateDir: stateDir,
      mainProjectDir: workDir,
      worktreeBranch: "",
      worktreePath: workDir,
      worktreeMetaDir: join(stateDir, "worktree-meta"),
    },
    runtime: {
      runId: "run-agg",
      selfCommand: "true",
      promptOverride: null,
      backendOverride: {},
      logLevel: "info",
      branchMode: false,
      isolationMode: "shared",
    },
    launch: {
      preset: "autocode",
      trigger: "cli",
      createdAt: new Date().toISOString(),
      parentRunId: "",
    },
    store: {},
    agentMap: null,
  } as unknown as LoopContext;
}

/** Build a branch spec + directory. If `summary` is given, a summary.json is
 * pre-written so the branch resolves immediately on the first poll. */
function makeBranchSpec(
  waveDir: string,
  index: number,
  summary?: { stopReason: string },
): BranchSpec {
  const branchId = `branch-${index}`;
  const branchDir = join(waveDir, "branches", branchId);
  mkdirSync(branchDir, { recursive: true });
  const spec: BranchSpec = {
    branchId,
    waveId: "wave-test",
    objective: `objective ${index}`,
    emittedTopic: "explore.parallel",
    routingEvent: "loop.start",
    allowedRoles: [],
    allowedEvents: [],
    prompt: "do it",
    branchDir,
    launchFile: join(branchDir, "launch.json"),
    summaryFile: join(branchDir, "summary.json"),
    stdoutFile: join(branchDir, "stdout.log"),
    stderrFile: join(branchDir, "stderr.log"),
    statusFile: join(branchDir, "status.txt"),
    pidFile: join(branchDir, "pid.txt"),
    supervisorFile: join(branchDir, "supervisor.sh"),
    launchMs: Date.now(),
  };
  if (summary) {
    writeParallelBranchSummary(branchDir, {
      branch_id: branchId,
      objective: spec.objective,
      stop_reason: summary.stopReason,
      output: "",
      routing_event: spec.routingEvent,
      allowed_roles: [],
      allowed_events: [],
      elapsed_ms: 10,
      finished_at_ms: Date.now(),
    });
  }
  return spec;
}

function waveScratch(loop: LoopContext): string {
  const dir = join(loop.paths.stateDir, "waves", "wave-test");
  mkdirSync(join(dir, "branches"), { recursive: true });
  return dir;
}

describe("joinParallelBranches aggregate modes", () => {
  it("wait_for_all: blocks until every branch resolves", () => {
    const loop = makeLoop("wait-for-all");
    const iter = buildIterationContext(loop, 1);
    const waveDir = waveScratch(loop);
    const specs = [
      makeBranchSpec(waveDir, 1, { stopReason: "completion_event" }),
      makeBranchSpec(waveDir, 2, { stopReason: "max_iterations" }),
    ];
    const aggregate: AggregateConfig = { mode: "wait_for_all", timeoutMs: 0 };

    const { results, aggregateOutcome } = joinParallelBranches(
      loop,
      iter,
      "wave-test",
      specs,
      aggregate,
      Date.now(),
    );

    expect(results).toHaveLength(2);
    expect(aggregateOutcome.mode).toBe("wait_for_all");
    expect(aggregateOutcome.aggregateTimedOut).toBe(false);
    expect(aggregateOutcome.satisfiedByBranchId).toBeUndefined();
  });

  it("first_success: resolves as soon as one branch succeeds and cancels the rest", () => {
    const loop = makeLoop("first-success");
    const iter = buildIterationContext(loop, 1);
    const waveDir = waveScratch(loop);
    // branch-1 already succeeded; branch-2 has no summary/status yet (still running).
    const specs = [
      makeBranchSpec(waveDir, 1, { stopReason: "completion_event" }),
      makeBranchSpec(waveDir, 2),
    ];
    const aggregate: AggregateConfig = { mode: "first_success", timeoutMs: 0 };

    const { results, aggregateOutcome } = joinParallelBranches(
      loop,
      iter,
      "wave-test",
      specs,
      aggregate,
      Date.now(),
    );

    expect(results).toHaveLength(2);
    expect(aggregateOutcome.satisfiedByBranchId).toBe("branch-1");
    const cancelled = results.find((r) => r.branchId === "branch-2");
    expect(cancelled?.stopReason).toBe("wave_cancelled_first_success");
  });

  it("timeout: bounds the wall clock and cancels stragglers at the deadline", () => {
    const loop = makeLoop("timeout-mode");
    const iter = buildIterationContext(loop, 1);
    const waveDir = waveScratch(loop);
    // Neither branch has a summary/status — both are still "running".
    const specs = [makeBranchSpec(waveDir, 1), makeBranchSpec(waveDir, 2)];
    const aggregate: AggregateConfig = { mode: "timeout", timeoutMs: 1 };

    const { results, aggregateOutcome } = joinParallelBranches(
      loop,
      iter,
      "wave-test",
      specs,
      aggregate,
      Date.now() - 100, // wave "started" well before the 1ms deadline
    );

    expect(results).toHaveLength(2);
    expect(aggregateOutcome.aggregateTimedOut).toBe(true);
    for (const r of results) {
      expect(r.stopReason).toBe("wave_aggregate_timeout");
    }
  });
});

describe("finalizeParallelWave aggregate-aware verdicts", () => {
  function iterFor(loop: LoopContext) {
    return buildIterationContext(loop, 1);
  }

  it("wait_for_all: any non-success branch fails the whole wave", () => {
    const loop = makeLoop("finalize-wait-fail");
    const iter = iterFor(loop);
    const results = [
      {
        branchId: "branch-1",
        objective: "o1",
        stopReason: "completion_event",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
      {
        branchId: "branch-2",
        objective: "o2",
        stopReason: "branch_process_failed",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
    ];
    const aggregate: AggregateConfig = { mode: "wait_for_all", timeoutMs: 0 };
    const outcome = finalizeParallelWave(
      loop,
      iter,
      "wave-x",
      results,
      aggregate,
      {
        mode: "wait_for_all",
        aggregateTimedOut: false,
      },
    );
    expect(outcome.reason).toBe("parallel_wave_failed");
  });

  it("first_success: a satisfied wave completes even with cancelled siblings", () => {
    const loop = makeLoop("finalize-first-success");
    const iter = iterFor(loop);
    const results = [
      {
        branchId: "branch-1",
        objective: "o1",
        stopReason: "completion_event",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
      {
        branchId: "branch-2",
        objective: "o2",
        stopReason: "wave_cancelled_first_success",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
    ];
    const aggregate: AggregateConfig = { mode: "first_success", timeoutMs: 0 };
    const outcome = finalizeParallelWave(
      loop,
      iter,
      "wave-x",
      results,
      aggregate,
      {
        mode: "first_success",
        satisfiedByBranchId: "branch-1",
        aggregateTimedOut: false,
      },
    );
    expect(outcome.reason).toBe("parallel_wave_complete");

    const lines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
    const aggLine = lines.find((l) => extractTopic(l) === "wave.aggregate");
    expect(aggLine).toBeDefined();
    expect(extractField(aggLine as string, "mode")).toBe("first_success");
    expect(extractField(aggLine as string, "satisfied_by_branch_id")).toBe(
      "branch-1",
    );
  });

  it("first_success: no winner at all falls back to a failed/timeout verdict, not silently complete", () => {
    const loop = makeLoop("finalize-first-success-no-winner");
    const iter = iterFor(loop);
    const results = [
      {
        branchId: "branch-1",
        objective: "o1",
        stopReason: "branch_process_failed",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
    ];
    const aggregate: AggregateConfig = { mode: "first_success", timeoutMs: 0 };
    const outcome = finalizeParallelWave(
      loop,
      iter,
      "wave-x",
      results,
      aggregate,
      {
        mode: "first_success",
        aggregateTimedOut: false,
      },
    );
    expect(outcome.reason).toBe("parallel_wave_failed");
  });

  it("timeout: a success recorded before the deadline still completes the wave", () => {
    const loop = makeLoop("finalize-timeout-success");
    const iter = iterFor(loop);
    const results = [
      {
        branchId: "branch-1",
        objective: "o1",
        stopReason: "completion_event",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
      {
        branchId: "branch-2",
        objective: "o2",
        stopReason: "wave_aggregate_timeout",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
    ];
    const aggregate: AggregateConfig = { mode: "timeout", timeoutMs: 5 };
    const outcome = finalizeParallelWave(
      loop,
      iter,
      "wave-x",
      results,
      aggregate,
      {
        mode: "timeout",
        aggregateTimedOut: true,
      },
    );
    expect(outcome.reason).toBe("parallel_wave_complete");
  });

  it("timeout: no success by the deadline is a wave timeout", () => {
    const loop = makeLoop("finalize-timeout-no-success");
    const iter = iterFor(loop);
    const results = [
      {
        branchId: "branch-1",
        objective: "o1",
        stopReason: "wave_aggregate_timeout",
        output: "",
        routingEvent: "loop.start",
        allowedRoles: [],
        allowedEvents: [],
        branchDir: "",
        elapsedMs: 1,
        finishedAtMs: 1,
      },
    ];
    const aggregate: AggregateConfig = { mode: "timeout", timeoutMs: 5 };
    const outcome = finalizeParallelWave(
      loop,
      iter,
      "wave-x",
      results,
      aggregate,
      {
        mode: "timeout",
        aggregateTimedOut: true,
      },
    );
    expect(outcome.reason).toBe("parallel_wave_timeout");
  });
});
