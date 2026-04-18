import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpClientOptions } from "../../src/backend/acp-client.js";
import type { KiroSessionHandle } from "../../src/backend/kiro-bridge.js";
import { resolveOutcome, runIteration } from "@mobrienv/autoloop-harness/iteration";
import type { LoopContext, RunSummary } from "@mobrienv/autoloop-harness/types";
import type { Role } from "@mobrienv/autoloop-core/topology";

const backendMocks = vi.hoisted(() => ({
  runProcess: vi.fn(),
  runKiroIterationSync: vi.fn(),
  setKiroSessionMode: vi.fn(),
  setKiroSessionModel: vi.fn(),
  initKiroSession: vi.fn(),
  terminateKiroSession: vi.fn(),
}));

vi.mock("../../src/backend/kiro-bridge.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/backend/kiro-bridge.js")
  >("../../src/backend/kiro-bridge.js");
  return {
    ...actual,
    runKiroIterationSync: backendMocks.runKiroIterationSync,
    setKiroSessionMode: backendMocks.setKiroSessionMode,
    setKiroSessionModel: backendMocks.setKiroSessionModel,
    initKiroSession: backendMocks.initKiroSession,
    terminateKiroSession: backendMocks.terminateKiroSession,
  };
});

vi.mock("../../src/harness/parallel.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/harness/parallel.js")
  >("../../src/harness/parallel.js");
  return {
    ...actual,
    runProcess: backendMocks.runProcess,
  };
});

const base = {
  emittedTopic: "",
  allTopics: [] as string[],
  hadInvalidEvents: false,
  output: "",
  completionEvent: "task.complete",
  requiredEvents: [] as string[],
  completionPromise: "",
};

describe("resolveOutcome", () => {
  it("returns complete_event when completion event and all required events are present", () => {
    const result = resolveOutcome({
      ...base,
      allTopics: ["step.done", "task.complete"],
      requiredEvents: ["step.done"],
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("returns complete_event even without required events when list is empty", () => {
    const result = resolveOutcome({
      ...base,
      allTopics: ["task.complete"],
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("does not complete via event when required events are missing", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "step.done",
      allTopics: ["step.done"],
      requiredEvents: ["verify.done"],
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });

  it("returns continue_routed for a non-completion accepted event", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "plan.ready",
      allTopics: ["plan.ready"],
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });

  it("returns complete_promise when output contains the promise string", () => {
    const result = resolveOutcome({
      ...base,
      output: "some output LOOP_COMPLETE more output",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "complete_promise",
      outcome: "complete:completion_promise",
    });
  });

  it("does not complete via promise when there were invalid events", () => {
    const result = resolveOutcome({
      ...base,
      hadInvalidEvents: true,
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("does not complete via promise when promise is empty string", () => {
    const result = resolveOutcome({
      ...base,
      output: "anything",
      completionPromise: "",
    });
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("returns continue as the default fallback", () => {
    const result = resolveOutcome(base);
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("prefers completion event over routed event and promise", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "task.complete",
      allTopics: ["task.complete"],
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "complete_event",
      outcome: "complete:completion_event",
    });
  });

  it("prefers routed event over promise completion", () => {
    const result = resolveOutcome({
      ...base,
      emittedTopic: "plan.ready",
      allTopics: ["plan.ready"],
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
    });
    expect(result).toEqual({
      action: "continue_routed",
      outcome: "continue:routed_event",
    });
  });
});

interface IterLoopOpts {
  roles?: Role[];
  handoff?: Record<string, string[]>;
  handoffKeys?: string[];
  backendKind?: string;
  backendCommand?: string;
  backendTimeoutMs?: number;
  kiroSession?: KiroSessionHandle;
}

function makeIterLoop(name: string, opts: IterLoopOpts = {}): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-iter-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const roles: Role[] = opts.roles ?? [
    { id: "builder", prompt: "", promptFile: "", emits: ["review.ready"] },
  ];
  const handoff = opts.handoff ?? { "loop.start": ["builder"] };
  const handoffKeys = opts.handoffKeys ?? Object.keys(handoff);
  const loop: LoopContext = {
    objective: "Iteration branch smoke",
    topology: {
      name: "t",
      completion: "task.complete",
      roles,
      handoff,
      handoffKeys,
    },
    limits: { maxIterations: 1 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: opts.backendKind ?? "command",
      command: opts.backendCommand ?? "claude",
      args: [],
      promptMode: "stdin",
      timeoutMs: opts.backendTimeoutMs ?? 2000,
    },
    review: {
      enabled: false,
      every: 4,
      kind: "command",
      command: "claude",
      args: [],
      promptMode: "stdin",
      prompt: "",
      timeoutMs: 1000,
    },
    parallel: { enabled: false, maxBranches: 0, branchTimeoutMs: 0 },
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
      runId: "run-iter",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      logLevel: "error",
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
  };
  if (opts.kiroSession) loop.kiroSession = opts.kiroSession;
  return loop;
}

const okResult = { output: "", exitCode: 0, timedOut: false };
const noopIterate = (): RunSummary => ({
  iterations: 1,
  stopReason: "test-stop",
});

function makeFakeSession(
  opts: Partial<KiroSessionHandle> = {},
): KiroSessionHandle {
  return {
    worker: {} as KiroSessionHandle["worker"],
    controlBuffer: new SharedArrayBuffer(4),
    dataBuffer: new SharedArrayBuffer(16),
    signature: opts.signature ?? "",
    currentAgent: opts.currentAgent ?? "",
    currentModel: opts.currentModel ?? "",
  };
}

/** Build the AcpClientOptions that ensureKiroSession will compute for a given
 * LoopContext + role. Mirrors buildAcpOpts in src/harness/iteration.ts. */
function expectedAcpOpts(
  loop: LoopContext,
  overrides: Partial<AcpClientOptions> = {},
): AcpClientOptions {
  return {
    command: loop.backend.command,
    args: loop.backend.args,
    cwd: loop.paths.workDir,
    trustAllTools: loop.store.kiro_trust_all_tools !== false,
    agentName: undefined,
    modelId: undefined,
    verbose: loop.runtime.logLevel === "debug",
    ...overrides,
  };
}

describe("runIteration backend branch selection", () => {
  beforeEach(() => {
    backendMocks.runProcess.mockReset().mockReturnValue(okResult);
    backendMocks.runKiroIterationSync.mockReset().mockReturnValue(okResult);
    backendMocks.setKiroSessionMode.mockReset();
    backendMocks.setKiroSessionModel.mockReset();
    backendMocks.initKiroSession.mockReset();
    backendMocks.terminateKiroSession.mockReset();
  });

  it("reuses an existing kiro session when the signature matches and applies agent switch when the tracked agent differs", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const loop = makeIterLoop("sig-match-agent", {
      backendKind: "kiro",
    });
    const expectedSig = kiroSessionSignature(
      expectedAcpOpts(loop, { agentName: "new-agent", modelId: "sonnet" }),
    );
    const existing = makeFakeSession({
      signature: expectedSig,
      currentAgent: "old-agent",
      currentModel: "sonnet",
    });
    loop.kiroSession = existing;
    loop.topology.roles = [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendAgent: "new-agent",
        backendModel: "sonnet",
        backendTimeoutMs: 9000,
      },
    ];

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.initKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.terminateKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionMode).toHaveBeenCalledTimes(1);
    expect(backendMocks.setKiroSessionMode).toHaveBeenCalledWith(
      existing,
      "new-agent",
    );
    expect(backendMocks.setKiroSessionModel).not.toHaveBeenCalled();
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledOnce();
    const [session, , timeoutMs] =
      backendMocks.runKiroIterationSync.mock.calls[0];
    expect(session).toBe(existing);
    expect(timeoutMs).toBe(9000);
    expect(loop.kiroSession).toBe(existing);
  });

  it("reuses the existing kiro session with no ACP round-trips when neither agent nor model changed", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const loop = makeIterLoop("sig-match-noop", { backendKind: "kiro" });
    const expectedSig = kiroSessionSignature(
      expectedAcpOpts(loop, { agentName: "same-agent", modelId: "same-model" }),
    );
    const existing = makeFakeSession({
      signature: expectedSig,
      currentAgent: "same-agent",
      currentModel: "same-model",
    });
    loop.kiroSession = existing;
    loop.topology.roles = [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendAgent: "same-agent",
        backendModel: "same-model",
      },
    ];

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.initKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.terminateKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionMode).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionModel).not.toHaveBeenCalled();
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledOnce();
  });

  it("terminates and re-inits when the command portion of the signature differs", () => {
    const loop = makeIterLoop("sig-mismatch-command", {
      backendKind: "kiro",
    });
    const stale = makeFakeSession({
      signature: "kiro|stale-cmd|[]|/tmp|1||",
      currentAgent: "",
      currentModel: "",
    });
    loop.kiroSession = stale;
    const fresh = makeFakeSession({
      signature: "fresh-after-init",
      currentAgent: "",
      currentModel: "",
    });
    backendMocks.initKiroSession.mockReturnValue(fresh);
    loop.topology.roles = [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendCommand: "different-kiro-bin",
      },
    ];

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(stale);
    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    const opts = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(opts.command).toBe("different-kiro-bin");
    expect(opts.cwd).toBe(loop.paths.workDir);
    expect(loop.kiroSession).toBe(fresh);
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledOnce();
    expect(backendMocks.runKiroIterationSync.mock.calls[0][0]).toBe(fresh);
  });

  it("terminates and re-inits when only the model portion of the signature differs", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const loop = makeIterLoop("sig-mismatch-model", {
      backendKind: "kiro",
    });
    const staleSig = kiroSessionSignature(
      expectedAcpOpts(loop, { modelId: "old-model" }),
    );
    const stale = makeFakeSession({
      signature: staleSig,
      currentAgent: "",
      currentModel: "old-model",
    });
    loop.kiroSession = stale;
    const fresh = makeFakeSession({
      signature: "new-sig",
      currentAgent: "",
      currentModel: "new-model",
    });
    backendMocks.initKiroSession.mockReturnValue(fresh);
    loop.topology.roles = [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendModel: "new-model",
      },
    ];

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(stale);
    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    const opts = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(opts.modelId).toBe("new-model");
    expect(backendMocks.setKiroSessionModel).not.toHaveBeenCalled();
    expect(loop.kiroSession).toBe(fresh);
  });

  it("lazy-inits a kiro session when the iteration requires kiro and no live session exists", () => {
    const loop = makeIterLoop("lazy-init", { backendKind: "kiro" });
    const fresh = makeFakeSession({
      signature: "new-sig",
      currentAgent: "planner-agent",
      currentModel: "",
    });
    backendMocks.initKiroSession.mockReturnValue(fresh);
    loop.topology.roles = [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendAgent: "planner-agent",
      },
    ];

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.terminateKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    const opts = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(opts.cwd).toBe(loop.paths.workDir);
    expect(opts.agentName).toBe("planner-agent");
    expect(loop.kiroSession).toBe(fresh);
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledOnce();
  });

  it("eagerly terminates a live kiro session when the next iteration is non-kiro", () => {
    const existing = makeFakeSession({ signature: "whatever" });
    const loop = makeIterLoop("eager-close", {
      backendKind: "command",
      kiroSession: existing,
    });

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(existing);
    expect(loop.kiroSession).toBeUndefined();
    expect(backendMocks.runKiroIterationSync).not.toHaveBeenCalled();
    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
  });

  it("across a non-kiro → kiro sequence terminates once then lazy-inits once", () => {
    const existing = makeFakeSession({ signature: "whatever" });
    const loop = makeIterLoop("non-kiro-then-kiro", {
      backendKind: "command",
      kiroSession: existing,
    });
    const fresh = makeFakeSession({ signature: "fresh" });
    backendMocks.initKiroSession.mockReturnValue(fresh);
    // Iteration 1 routes to a non-kiro role; iteration 2 routes to a kiro role.
    loop.topology.roles = [
      { id: "builder", prompt: "", promptFile: "", emits: ["review.ready"] },
      {
        id: "planner",
        prompt: "",
        promptFile: "",
        emits: ["tasks.ready"],
        backendKind: "kiro",
      },
    ];
    loop.topology.handoff = { "loop.start": ["builder"] };
    loop.topology.handoffKeys = ["loop.start"];

    const recurse = (ctx: LoopContext, iteration: number): RunSummary => {
      if (iteration >= 3) return { iterations: 2, stopReason: "test-stop" };
      // Before iter 2, flip the route so "loop.start" now points at the kiro role.
      ctx.topology.handoff = { "loop.start": ["planner"] };
      return runIteration(ctx, iteration, recurse);
    };

    runIteration(loop, 1, recurse);

    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(existing);
    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    expect(loop.kiroSession).toBe(fresh);
  });
});
