import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import type { BranchResult, FanoutStage } from "@mobrienv/autoloop-core/fanout";
import { appendEvent, readRunLines } from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const branchRunnerCalls: string[] = [];
const stubResults = new Map<string, BranchResult>();

vi.mock("../../src/wave/stage-branch-runner.js", () => ({
  buildStageBranchRunner:
    () =>
    async (spec: { branchId: string }): Promise<BranchResult> => {
      branchRunnerCalls.push(spec.branchId);
      return (
        stubResults.get(spec.branchId) ?? {
          branchId: spec.branchId,
          ok: true,
          data: { affirm: true },
        }
      );
    },
}));

import type { IterationContext } from "../../src/prompt.js";
import { finishStageIteration, loadResumedBranches } from "../../src/stage.js";

function stage(overrides: Partial<FanoutStage> = {}): FanoutStage {
  return {
    id: "verify",
    kind: "verdict",
    trigger: "verify.panel",
    branches: 3,
    role: "verifier",
    roles: [],
    join: "majority-vote",
    requires: ["affirm"],
    voteField: "affirm",
    voteThreshold: "majority",
    itemsField: "findings",
    keyField: "key",
    countMin: 1,
    quorum: 0,
    onPass: "verify.passed",
    onFail: "verify.blocked",
    synthesizerRole: "",
    ...overrides,
  };
}

function makeLoop(): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-stage-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  return {
    objective: "verify the thing",
    topology: {
      name: "p",
      completion: "task.complete",
      roles: [
        {
          id: "verifier",
          prompt: "verify",
          promptFile: "",
          emits: ["verify.panel", "verify.passed", "verify.blocked"],
        },
      ],
      handoff: {
        "loop.start": ["verifier"],
        "verify.panel": [],
        "verify.passed": ["verifier"],
        "verify.blocked": ["verifier"],
      },
      handoffKeys: [
        "loop.start",
        "verify.panel",
        "verify.passed",
        "verify.blocked",
      ],
      gates: [],
      stages: [stage()],
    },
    limits: { maxIterations: 10, maxCostUsd: 0 },
    completion: { promise: "DONE", event: "task.complete", requiredEvents: [] },
    acceptance: {
      verifyCmds: [],
      timeoutMs: 300000,
      assertNoTodo: false,
      assertNoSkippedTests: false,
      assertNoSecrets: false,
      assertCleanTree: false,
      screenTestTamper: false,
      criteria: [],
    },
    ask: { enabled: false, event: "human.ask", timeoutMs: 0, pollMs: 0 },
    backend: {
      kind: "command",
      provider: "",
      command: "claude",
      args: [],
      promptMode: "arg",
      timeoutMs: 1000,
      trustAllTools: true,
      agent: "",
      model: "",
      disallowedTools: [],
    },
    review: {
      enabled: false,
      every: 1,
      adversarialFirst: true,
      kind: "command",
      provider: "",
      command: "echo",
      args: [],
      promptMode: "arg",
      prompt: "",
      timeoutMs: 1000,
      trustAllTools: true,
      agent: "",
      model: "",
      onError: "hold",
      minConfidence: 0.5,
    },
    parallel: { enabled: false, maxBranches: 0, branchTimeoutMs: 0 },
    stage: { concurrency: 4, branchTimeoutMs: 60000 },
    hooks: {
      preRun: "",
      preIteration: "",
      postIteration: "",
      postRun: "",
      strict: false,
    },
    memory: { budgetChars: 1000 },
    tasks: { budgetChars: 1000 },
    harness: { instructions: "" },
    profiles: { active: [], fragments: new Map(), warnings: [] },
    paths: {
      projectDir: workDir,
      workDir,
      stateDir,
      journalFile,
      memoryFile: join(stateDir, "memory.jsonl"),
      runMemoryFile: join(stateDir, "run-memory.jsonl"),
      tasksFile: join(stateDir, "tasks.jsonl"),
      registryFile: join(stateDir, "registry.jsonl"),
      toolPath: join(stateDir, "autoloop"),
      piAdapterPath: join(stateDir, "pi-adapter"),
      baseStateDir: stateDir,
      mainProjectDir: workDir,
      worktreeBranch: "",
      worktreePath: workDir,
      worktreeMetaDir: join(stateDir, "worktree-meta"),
      configWorkDir: workDir,
    },
    runtime: {
      runId: "run-stage",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      configOverride: {},
      logLevel: "info",
      branchMode: false,
      isolationMode: "shared",
    },
    launch: {
      preset: "p",
      trigger: "cli",
      createdAt: new Date().toISOString(),
      parentRunId: "",
    },
    store: {},
    agentMap: null,
    acpSession: { current: undefined },
    piSession: { current: undefined },
    claudeSdkSession: { current: undefined },
  } as unknown as LoopContext;
}

function iterCtx(iteration = 1): IterationContext {
  return {
    iteration,
    recentEvent: "verify.panel",
    allowedRoles: [],
    allowedEvents: [],
    backpressure: "",
    lastRejected: "",
    scratchpadText: "",
    memoryText: "",
    prompt: "",
    roleAgent: "",
    backend: {} as never,
    backendAgent: "",
    backendModel: "",
  } as unknown as IterationContext;
}

beforeEach(() => {
  branchRunnerCalls.length = 0;
  stubResults.clear();
});

describe("finishStageIteration", () => {
  it("runs every branch, journals stage.start/join, and routes to onPass on a majority", async () => {
    const loop = makeLoop();
    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));

    await finishStageIteration(
      loop,
      iterCtx(1),
      stage(),
      "verify.panel",
      iterate,
    );

    expect(branchRunnerCalls.sort()).toEqual([
      "verify.0",
      "verify.1",
      "verify.2",
    ]);
    expect(iterate).toHaveBeenCalledWith(loop, 2);

    const lines = readRunLines(loop.paths.journalFile, "run-stage");
    const topics = lines.map((l) => JSON.parse(l).topic ?? "");
    expect(topics).toContain("stage.start");
    expect(topics).toContain("stage.join");
    expect(topics).toContain("verify.passed");
  });

  it("routes to onFail when the vote does not pass", async () => {
    const loop = makeLoop();
    stubResults.set("verify.0", {
      branchId: "verify.0",
      ok: true,
      data: { affirm: false },
    });
    stubResults.set("verify.1", {
      branchId: "verify.1",
      ok: true,
      data: { affirm: false },
    });
    stubResults.set("verify.2", {
      branchId: "verify.2",
      ok: true,
      data: { affirm: false },
    });
    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));

    await finishStageIteration(
      loop,
      iterCtx(1),
      stage(),
      "verify.panel",
      iterate,
    );

    const lines = readRunLines(loop.paths.journalFile, "run-stage");
    const topics = lines.map((l) => JSON.parse(l).topic ?? "");
    expect(topics).toContain("verify.blocked");
    expect(topics).not.toContain("verify.passed");
  });
});

describe("branch-granular resume", () => {
  it("reuses journaled stage.branch.finish records instead of relaunching", async () => {
    const loop = makeLoop();
    // Pre-seed a prior (interrupted) attempt: two of three branches finished.
    appendEvent(
      loop.paths.journalFile,
      "run-stage",
      "1",
      "stage.branch.finish",
      `${jsonField("stage_id", "verify")}, ${jsonField("branch_id", "verify.0")}, ${jsonField("ok", "true")}, ${jsonField("data", JSON.stringify({ affirm: true }))}, ${jsonField("error", "")}, ${jsonField("elapsed_ms", "10")}`,
    );
    appendEvent(
      loop.paths.journalFile,
      "run-stage",
      "1",
      "stage.branch.finish",
      `${jsonField("stage_id", "verify")}, ${jsonField("branch_id", "verify.1")}, ${jsonField("ok", "true")}, ${jsonField("data", JSON.stringify({ affirm: true }))}, ${jsonField("error", "")}, ${jsonField("elapsed_ms", "10")}`,
    );

    const resumed = loadResumedBranches(loop, "verify");
    expect([...resumed.keys()].sort()).toEqual(["verify.0", "verify.1"]);

    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));
    await finishStageIteration(
      loop,
      iterCtx(2),
      stage(),
      "verify.panel",
      iterate,
    );

    // Only the branch without a journaled record was relaunched.
    expect(branchRunnerCalls).toEqual(["verify.2"]);
  });

  it("--no-resume forces every branch to relaunch", async () => {
    const loop = makeLoop();
    loop.runtime.noResume = true;
    appendEvent(
      loop.paths.journalFile,
      "run-stage",
      "1",
      "stage.branch.finish",
      `${jsonField("stage_id", "verify")}, ${jsonField("branch_id", "verify.0")}, ${jsonField("ok", "true")}, ${jsonField("data", JSON.stringify({ affirm: true }))}, ${jsonField("error", "")}, ${jsonField("elapsed_ms", "10")}`,
    );

    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));
    await finishStageIteration(
      loop,
      iterCtx(2),
      stage(),
      "verify.panel",
      iterate,
    );

    expect(branchRunnerCalls.sort()).toEqual([
      "verify.0",
      "verify.1",
      "verify.2",
    ]);
  });
});

describe("budget pre-admission", () => {
  it("admits every branch when no cost ceiling is set", async () => {
    const loop = makeLoop();
    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));
    await finishStageIteration(
      loop,
      iterCtx(1),
      stage(),
      "verify.panel",
      iterate,
    );
    expect(branchRunnerCalls).toHaveLength(3);
  });

  it("caps admission to what the remaining budget covers", async () => {
    const loop = makeLoop();
    loop.limits.maxCostUsd = 0.02;
    // Journal prior spend so runCostUsd() > 0 and the per-branch estimate is
    // derived from it (spend / iterations-so-far).
    appendEvent(
      loop.paths.journalFile,
      "run-stage",
      "1",
      "backend.usage",
      `${jsonField("cost_usd", "0.01")}`,
    );

    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));
    await finishStageIteration(
      loop,
      iterCtx(1),
      stage(),
      "verify.panel",
      iterate,
    );

    // Only 2 of 3 branches fit under the remaining budget at the estimate.
    expect(branchRunnerCalls.length).toBeLessThan(3);
  });
});
