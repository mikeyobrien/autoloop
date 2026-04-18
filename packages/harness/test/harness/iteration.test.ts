import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KiroSessionHandle } from "../../src/backend/kiro-bridge.js";
import { resolveOutcome, runIteration } from "@mobrienv/autoloop-harness/iteration";
import type { LoopContext, RunSummary } from "@mobrienv/autoloop-harness/types";
import type { Role } from "@mobrienv/autoloop-core/topology";

const backendMocks = vi.hoisted(() => ({
  runProcess: vi.fn(),
  runKiroIterationSync: vi.fn(),
  setKiroSessionMode: vi.fn(),
}));

vi.mock("../../src/backend/kiro-bridge.js", () => ({
  runKiroIterationSync: backendMocks.runKiroIterationSync,
  setKiroSessionMode: backendMocks.setKiroSessionMode,
}));

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

const fakeKiroSession = {} as KiroSessionHandle;
const okResult = { output: "", exitCode: 0, timedOut: false };
const noopIterate = (): RunSummary => ({
  iterations: 1,
  stopReason: "test-stop",
});

describe("runIteration backend branch selection", () => {
  beforeEach(() => {
    backendMocks.runProcess.mockReset().mockReturnValue(okResult);
    backendMocks.runKiroIterationSync.mockReset().mockReturnValue(okResult);
    backendMocks.setKiroSessionMode.mockReset();
  });

  it("invokes the kiro branch when iter.backend.kind is 'kiro' and loop.kiroSession is present", () => {
    const loop = makeIterLoop("kiro-present", {
      backendKind: "kiro",
      kiroSession: fakeKiroSession,
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendTimeoutMs: 7777,
        },
      ],
    });

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledOnce();
    expect(backendMocks.runProcess).not.toHaveBeenCalled();
    const [session, , timeoutMs] =
      backendMocks.runKiroIterationSync.mock.calls[0];
    expect(session).toBe(fakeKiroSession);
    expect(timeoutMs).toBe(7777);
  });

  it("falls through to the command branch when iter.backend.kind is 'kiro' but loop.kiroSession is missing", () => {
    const loop = makeIterLoop("kiro-no-session", {
      backendKind: "kiro",
    });

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    expect(backendMocks.runKiroIterationSync).not.toHaveBeenCalled();
  });

  it("takes the command branch when iter.backend.kind is not 'kiro' even if loop.kiroSession is present", () => {
    const loop = makeIterLoop("command-with-session", {
      backendKind: "command",
      kiroSession: fakeKiroSession,
    });

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    expect(backendMocks.runKiroIterationSync).not.toHaveBeenCalled();
  });

  it("passes iter.backend.timeoutMs and iter.backend.kind to runProcess on kind mismatch", () => {
    const loop = makeIterLoop("mismatch", {
      backendKind: "command",
      backendTimeoutMs: 2000,
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "pi",
          backendCommand: "pi-role-cmd",
          backendTimeoutMs: 4321,
        },
      ],
    });

    runIteration(loop, 1, noopIterate);

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    const [, timeoutMs, kind] = backendMocks.runProcess.mock.calls[0];
    expect(timeoutMs).toBe(4321);
    expect(kind).toBe("pi");
  });
});
