import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FanoutStage } from "@mobrienv/autoloop-core/fanout";
import { appendAgentEvent } from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const finishStageIterationMock = vi.fn(
  async (
    _loop: LoopContext,
    _iter: unknown,
    _stage: FanoutStage,
    _topic: string,
    iterate: (loop: LoopContext, iteration: number) => Promise<unknown>,
  ) => iterate(_loop, (_iter as { iteration: number }).iteration + 1),
);

vi.mock("../../src/stage.js", () => ({
  finishStageIteration: (...args: unknown[]) =>
    (finishStageIterationMock as unknown as (...a: unknown[]) => unknown)(
      ...args,
    ),
}));

import { finishIteration } from "../../src/iteration.js";
import type { IterationContext } from "../../src/prompt.js";

function stage(): FanoutStage {
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
  };
}

function makeLoop(): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-stage-dispatch-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  const tasksFile = join(stateDir, "tasks.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  writeFileSync(tasksFile, "", "utf-8");
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
    limits: { maxIterations: 10 },
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
      tasksFile,
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
      runId: "run-dispatch",
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

function iterCtx(iteration: number, recentEvent: string): IterationContext {
  return {
    iteration,
    recentEvent,
    allowedRoles: ["verifier"],
    allowedEvents: ["verify.panel"],
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
  finishStageIterationMock.mockClear();
});

describe("finishIteration — fan-out stage dispatch", () => {
  it("intercepts a stage's trigger event and hands off to finishStageIteration", async () => {
    const loop = makeLoop();
    appendAgentEvent(
      loop.paths.journalFile,
      "run-dispatch",
      "1",
      "verify.panel",
      "",
    );
    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));

    await finishIteration(loop, iterCtx(1, "loop.start"), "output", iterate);

    expect(finishStageIterationMock).toHaveBeenCalledTimes(1);
    const [, , calledStage, calledTopic] =
      finishStageIterationMock.mock.calls[0];
    expect((calledStage as FanoutStage).id).toBe("verify");
    expect(calledTopic).toBe("verify.panel");
  });

  it("does not intercept a normal (non-trigger) event", async () => {
    const loop = makeLoop();
    appendAgentEvent(
      loop.paths.journalFile,
      "run-dispatch",
      "1",
      "verify.passed",
      "",
    );
    const iterate = vi.fn(async (_l: LoopContext, iteration: number) => ({
      iterations: iteration,
      stopReason: "continued",
    }));

    const iter = iterCtx(1, "verify.blocked");
    iter.allowedEvents = ["verify.passed"];
    await finishIteration(loop, iter, "output", iterate);

    expect(finishStageIterationMock).not.toHaveBeenCalled();
    expect(iterate).toHaveBeenCalledWith(loop, 2);
  });
});
