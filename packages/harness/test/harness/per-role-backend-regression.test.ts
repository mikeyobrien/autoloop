import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMap } from "../../src/agent-map.js";
import type { AcpClientOptions } from "../../src/backend/acp-client.js";
import type { KiroSessionHandle } from "../../src/backend/kiro-bridge.js";
import { runIteration } from "../../src/harness/iteration.js";
import {
  appendAgentEvent,
  extractField,
  extractTopic,
  readLines,
} from "../../src/harness/journal.js";
import type { LoopContext, RunSummary } from "../../src/harness/types.js";
import type { Role } from "../../src/topology.js";

// Slice 7 — end-to-end regression coverage for per-role backend routing.
// Mocks exactly the process/ACP boundary; everything else (resolveIterationBackend,
// ensureKiroSession, buildIterationContext, buildBackendCommand, appendBackendStart,
// kiroSessionSignature) runs for real against multi-iteration sequences.
//
// Fixture choice: inline duplication of the iteration.test.ts helper shape rather
// than extracting to test/_fixtures/backend-loop.ts. Three ~40-line helpers are
// cheaper than a shared export contract across two files (see plan Slice 7).

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

const okResult = { output: "", exitCode: 0, timedOut: false };

interface RegressionLoopOpts {
  name: string;
  roles: Role[];
  handoff: Record<string, string[]>;
  backendKind?: string;
  backendCommand?: string;
  backendArgs?: string[];
  backendTimeoutMs?: number;
  agentMap?: AgentMap | null;
  preset?: string;
}

function makeRegressionLoop(opts: RegressionLoopOpts): LoopContext {
  const workDir = mkdtempSync(
    join(tmpdir(), `autoloop-per-role-${opts.name}-`),
  );
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  return {
    objective: "Per-role backend regression",
    topology: {
      name: "t",
      completion: "task.complete",
      roles: opts.roles,
      handoff: opts.handoff,
      handoffKeys: Object.keys(opts.handoff),
    },
    limits: { maxIterations: 10 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: opts.backendKind ?? "command",
      command: opts.backendCommand ?? "claude",
      args: opts.backendArgs ?? ["--flag"],
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
      runId: `run-${opts.name}`,
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      logLevel: "error",
      branchMode: false,
      isolationMode: "shared",
    },
    launch: {
      preset: opts.preset ?? "autocode",
      trigger: "cli",
      createdAt: new Date().toISOString(),
      parentRunId: "",
    },
    store: {},
    agentMap: opts.agentMap ?? null,
  };
}

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

/**
 * Iterate callback that advances the loop through `maxIters` real iterations.
 * Between iterations, `seed` (optional) is invoked so the test can emit the
 * agent event that drives routing from role A to role B on the next iter.
 */
function makeRecurse(
  maxIters: number,
  seed?: (loop: LoopContext, nextIteration: number) => void,
): (loop: LoopContext, iteration: number) => RunSummary {
  const recurse = (loop: LoopContext, iteration: number): RunSummary => {
    if (iteration > maxIters) {
      return { iterations: maxIters, stopReason: "test-stop" };
    }
    seed?.(loop, iteration);
    return runIteration(loop, iteration, recurse);
  };
  return recurse;
}

function readJournalLines(loop: LoopContext): string[] {
  return readLines(loop.paths.journalFile);
}

function backendStartLines(loop: LoopContext): string[] {
  return readJournalLines(loop).filter(
    (l) => extractTopic(l) === "backend.start",
  );
}

function backendStartForIteration(loop: LoopContext, iter: number): string {
  const match = backendStartLines(loop).find(
    (l) => extractField(l, "iteration") === String(iter),
  );
  return match ?? "";
}

/**
 * Extract the child invocation from the shell command that `runProcess` receives.
 * `wrapProcessInvocation` wraps the real child command in `(\n<child>\n) &\n`, so
 * the env-export preamble and the prompt body (which embeds the role deck) are
 * excluded — assertions that target the command binary don't collide with role
 * metadata printed in the prompt.
 */
function childInvocation(command: string): string {
  const start = command.indexOf("(\n");
  const end = command.indexOf("\n) &\n");
  if (start < 0 || end < 0 || end < start) return command;
  return command.slice(start + 2, end);
}

/**
 * For stdin-mode backends the child invocation has the form
 * `printf '%s' '<prompt>' | '<bin>' '<arg>' ...`. Returns everything after
 * the last ` | ` — i.e. the binary + argv portion.
 */
function pipeTail(command: string): string {
  const child = childInvocation(command);
  const idx = child.lastIndexOf(" | ");
  return idx < 0 ? child : child.slice(idx + 3);
}

describe("per-role backend end-to-end regression", () => {
  beforeEach(() => {
    backendMocks.runProcess.mockReset().mockReturnValue(okResult);
    backendMocks.runKiroIterationSync.mockReset().mockReturnValue(okResult);
    backendMocks.setKiroSessionMode.mockReset();
    backendMocks.setKiroSessionModel.mockReset();
    backendMocks.initKiroSession.mockReset();
    backendMocks.terminateKiroSession.mockReset();
  });

  it("global-only preset: behavior and backend.start are unchanged when no role has overrides", () => {
    const loop = makeRegressionLoop({
      name: "case1-global",
      roles: [
        { id: "builder", prompt: "", promptFile: "", emits: ["review.ready"] },
      ],
      handoff: { "loop.start": ["builder"] },
      backendKind: "command",
      backendCommand: "claude",
      backendArgs: ["--model", "sonnet"],
      backendTimeoutMs: 30000,
    });

    runIteration(loop, 1, makeRecurse(1));

    expect(backendMocks.runKiroIterationSync).not.toHaveBeenCalled();
    expect(backendMocks.initKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.terminateKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionMode).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionModel).not.toHaveBeenCalled();

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    const [command, timeoutMs, kind] = backendMocks.runProcess.mock.calls[0];
    const tail = pipeTail(command);
    expect(tail).toContain("'claude'");
    expect(tail).toContain("'--model'");
    expect(tail).toContain("'sonnet'");
    expect(timeoutMs).toBe(30000);
    expect(kind).toBe("command");

    const line = backendStartForIteration(loop, 1);
    expect(line).not.toBe("");
    expect(extractField(line, "backend_kind")).toBe("command");
    expect(extractField(line, "command")).toBe("claude");
    expect(extractField(line, "prompt_mode")).toBe("stdin");
    expect(extractField(line, "timeout_ms")).toBe("30000");
  });

  it("role-specific command override is honored per iteration and falls through to global on untouched fields", () => {
    const loop = makeRegressionLoop({
      name: "case2-command-override",
      roles: [
        {
          id: "planner",
          prompt: "",
          promptFile: "",
          emits: ["tasks.ready"],
          backendCommand: "planner-bin",
          backendArgs: ["--quick"],
          backendTimeoutMs: 5000,
        },
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
        },
      ],
      handoff: {
        "loop.start": ["planner"],
        "tasks.ready": ["builder"],
      },
      backendCommand: "global-bin",
      backendArgs: ["--slow"],
      backendTimeoutMs: 30000,
    });

    // Between iter 1 (planner) and iter 2 (builder) we seed a `tasks.ready`
    // agent event so routingEventFromLines returns "tasks.ready" and
    // suggestedRoles(topology, "tasks.ready") picks "builder".
    const seed = (ctx: LoopContext, nextIteration: number): void => {
      if (nextIteration !== 2) return;
      appendAgentEvent(
        ctx.paths.journalFile,
        ctx.runtime.runId,
        "1",
        "tasks.ready",
        "slice handoff",
      );
    };

    runIteration(loop, 1, makeRecurse(2, seed));

    expect(backendMocks.runKiroIterationSync).not.toHaveBeenCalled();
    expect(backendMocks.initKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.terminateKiroSession).not.toHaveBeenCalled();
    expect(backendMocks.runProcess).toHaveBeenCalledTimes(2);

    const [cmd1, to1, kind1] = backendMocks.runProcess.mock.calls[0];
    const tail1 = pipeTail(cmd1);
    expect(tail1).toContain("'planner-bin'");
    expect(tail1).toContain("'--quick'");
    expect(tail1).not.toContain("'global-bin'");
    expect(to1).toBe(5000);
    expect(kind1).toBe("command");

    const [cmd2, to2, kind2] = backendMocks.runProcess.mock.calls[1];
    const tail2 = pipeTail(cmd2);
    expect(tail2).toContain("'global-bin'");
    expect(tail2).toContain("'--slow'");
    expect(tail2).not.toContain("'planner-bin'");
    expect(to2).toBe(30000);
    expect(kind2).toBe("command");

    const line1 = backendStartForIteration(loop, 1);
    expect(extractField(line1, "command")).toBe("planner-bin");
    expect(extractField(line1, "timeout_ms")).toBe("5000");
    const line2 = backendStartForIteration(loop, 2);
    expect(extractField(line2, "command")).toBe("global-bin");
    expect(extractField(line2, "timeout_ms")).toBe("30000");
  });

  it("role-specific Kiro model override forces terminate + re-init when the signature changes", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const loop = makeRegressionLoop({
      name: "case3-kiro-model",
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "kiro",
          backendModel: "sonnet",
        },
        {
          id: "critic",
          prompt: "",
          promptFile: "",
          emits: ["review.passed", "review.rejected"],
          backendKind: "kiro",
          backendModel: "opus",
        },
      ],
      handoff: {
        "loop.start": ["builder"],
        "review.ready": ["critic"],
      },
      backendKind: "kiro",
      backendCommand: "kiro-cli",
      backendArgs: ["acp"],
    });

    // initKiroSession returns a fresh handle whose signature matches the
    // real kiroSessionSignature for the opts it was called with, so the
    // reuse-vs-re-init branch of ensureKiroSession evaluates for real.
    backendMocks.initKiroSession.mockImplementation((opts: AcpClientOptions) =>
      makeFakeSession({
        signature: kiroSessionSignature(opts),
        currentAgent: opts.agentName ?? "",
        currentModel: opts.modelId ?? "",
      }),
    );

    const seed = (ctx: LoopContext, nextIteration: number): void => {
      if (nextIteration !== 2) return;
      appendAgentEvent(
        ctx.paths.journalFile,
        ctx.runtime.runId,
        "1",
        "review.ready",
        "slice handoff",
      );
    };

    runIteration(loop, 1, makeRecurse(2, seed));

    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(2);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.setKiroSessionMode).not.toHaveBeenCalled();
    expect(backendMocks.setKiroSessionModel).not.toHaveBeenCalled();
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledTimes(2);
    expect(backendMocks.runProcess).not.toHaveBeenCalled();

    const opts1 = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(opts1.command).toBe("kiro-cli");
    expect(opts1.args).toEqual(["acp"]);
    expect(opts1.modelId).toBe("sonnet");

    const session1 = backendMocks.initKiroSession.mock.results[0]
      .value as KiroSessionHandle;
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(session1);

    const opts2 = backendMocks.initKiroSession.mock
      .calls[1][0] as AcpClientOptions;
    expect(opts2.modelId).toBe("opus");

    const session2 = backendMocks.initKiroSession.mock.results[1]
      .value as KiroSessionHandle;
    expect(session2).not.toBe(session1);
    expect(loop.kiroSession).toBe(session2);

    const [iter1Handle] = backendMocks.runKiroIterationSync.mock.calls[0];
    const [iter2Handle] = backendMocks.runKiroIterationSync.mock.calls[1];
    expect(iter1Handle).toBe(session1);
    expect(iter2Handle).toBe(session2);
  });

  it("agents.toml resolves the Kiro agent when the role sets no backend_agent", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const agentMap: AgentMap = {
      globalDefault: "",
      presets: {
        autocode: {
          defaultAgent: "",
          roles: { builder: "autocode-builder-agent" },
        },
      },
    };
    const loop = makeRegressionLoop({
      name: "case4-agents-toml",
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "kiro",
        },
      ],
      handoff: { "loop.start": ["builder"] },
      backendKind: "kiro",
      backendCommand: "kiro-cli",
      backendArgs: ["acp"],
      agentMap,
      preset: "autocode",
    });

    backendMocks.initKiroSession.mockImplementation((opts: AcpClientOptions) =>
      makeFakeSession({
        signature: kiroSessionSignature(opts),
        currentAgent: opts.agentName ?? "",
        currentModel: opts.modelId ?? "",
      }),
    );

    runIteration(loop, 1, makeRecurse(1));

    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    const opts = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(opts.agentName).toBe("autocode-builder-agent");

    const session = backendMocks.initKiroSession.mock.results[0]
      .value as KiroSessionHandle;
    expect(session.signature).toBe(kiroSessionSignature(opts));
    expect(session.signature).toContain("autocode-builder-agent");
    expect(loop.kiroSession).toBe(session);
  });

  it("mixed command → kiro → command sequence lazy-inits kiro once then eagerly terminates on the non-kiro iter", async () => {
    const { kiroSessionSignature } = await import(
      "../../src/backend/kiro-bridge.js"
    );
    const loop = makeRegressionLoop({
      name: "case5-mixed",
      roles: [
        { id: "planner", prompt: "", promptFile: "", emits: ["tasks.ready"] },
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "kiro",
          backendCommand: "kiro-cli",
          backendArgs: ["acp"],
        },
        {
          id: "critic",
          prompt: "",
          promptFile: "",
          emits: ["review.passed"],
          backendKind: "command",
          backendCommand: "critic-bin",
        },
      ],
      handoff: {
        "loop.start": ["planner"],
        "tasks.ready": ["builder"],
        "review.ready": ["critic"],
      },
      backendKind: "command",
      backendCommand: "global-bin",
    });

    backendMocks.initKiroSession.mockImplementation((opts: AcpClientOptions) =>
      makeFakeSession({
        signature: kiroSessionSignature(opts),
        currentAgent: opts.agentName ?? "",
        currentModel: opts.modelId ?? "",
      }),
    );

    const seed = (ctx: LoopContext, nextIteration: number): void => {
      if (nextIteration === 2) {
        appendAgentEvent(
          ctx.paths.journalFile,
          ctx.runtime.runId,
          "1",
          "tasks.ready",
          "slice handoff",
        );
      } else if (nextIteration === 3) {
        appendAgentEvent(
          ctx.paths.journalFile,
          ctx.runtime.runId,
          "2",
          "review.ready",
          "slice handoff",
        );
      }
    };

    runIteration(loop, 1, makeRecurse(3, seed));

    expect(backendMocks.initKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledTimes(1);
    expect(backendMocks.runKiroIterationSync).toHaveBeenCalledTimes(1);
    expect(backendMocks.runProcess).toHaveBeenCalledTimes(2);

    const session = backendMocks.initKiroSession.mock.results[0]
      .value as KiroSessionHandle;
    expect(backendMocks.terminateKiroSession).toHaveBeenCalledWith(session);
    expect(loop.kiroSession).toBeUndefined();

    const plannerCall = backendMocks.runProcess.mock.calls[0];
    expect(pipeTail(plannerCall[0])).toContain("'global-bin'");
    const criticCall = backendMocks.runProcess.mock.calls[1];
    expect(pipeTail(criticCall[0])).toContain("'critic-bin'");

    const kiroInitOpts = backendMocks.initKiroSession.mock
      .calls[0][0] as AcpClientOptions;
    expect(kiroInitOpts.command).toBe("kiro-cli");
    expect(kiroInitOpts.args).toEqual(["acp"]);
  });

  it("first suggested role wins when multiple roles are allowed on the same routing event", () => {
    const roles: Role[] = [
      {
        id: "planner",
        prompt: "",
        promptFile: "",
        emits: ["tasks.ready"],
        backendCommand: "planner-bin",
      },
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
        backendCommand: "builder-bin",
      },
    ];

    const plannerFirst = makeRegressionLoop({
      name: "case6-planner-first",
      roles,
      handoff: { "loop.start": ["planner", "builder"] },
    });

    runIteration(plannerFirst, 1, makeRecurse(1));

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    const [plannerCmd] = backendMocks.runProcess.mock.calls[0];
    const plannerTail = pipeTail(plannerCmd);
    expect(plannerTail).toContain("'planner-bin'");
    expect(plannerTail).not.toContain("'builder-bin'");

    const plannerLine = backendStartForIteration(plannerFirst, 1);
    expect(extractField(plannerLine, "command")).toBe("planner-bin");

    // Swap order; build a fresh LoopContext to avoid cross-contamination via
    // journal state or the resolved backend cache.
    backendMocks.runProcess.mockClear();
    const builderFirst = makeRegressionLoop({
      name: "case6-builder-first",
      roles,
      handoff: { "loop.start": ["builder", "planner"] },
    });

    runIteration(builderFirst, 1, makeRecurse(1));

    expect(backendMocks.runProcess).toHaveBeenCalledOnce();
    const [builderCmd] = backendMocks.runProcess.mock.calls[0];
    const builderTail = pipeTail(builderCmd);
    expect(builderTail).toContain("'builder-bin'");
    expect(builderTail).not.toContain("'planner-bin'");

    const builderLine = backendStartForIteration(builderFirst, 1);
    expect(extractField(builderLine, "command")).toBe("builder-bin");
  });
});
