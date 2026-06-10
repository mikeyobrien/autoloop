import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { PiSession } from "@mobrienv/autoloop-backends/pi-rpc-client";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const acpMocks = vi.hoisted(() => ({
  initAcpSession: vi.fn(),
  terminateAcpSession: vi.fn(),
  runAcpIteration: vi.fn(),
}));

const piMocks = vi.hoisted(() => ({
  initPiSession: vi.fn(),
  resetPiSession: vi.fn(),
  terminatePiSession: vi.fn(),
  runPiIteration: vi.fn(),
  getPiSessionStats: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-backends", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-backends")>();
  return {
    ...actual,
    runAcpIteration: acpMocks.runAcpIteration,
    runPiIteration: piMocks.runPiIteration,
  };
});

vi.mock("@mobrienv/autoloop-backends/acp-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@mobrienv/autoloop-backends/acp-client")
    >();
  return {
    ...actual,
    initAcpSession: acpMocks.initAcpSession,
    terminateAcpSession: acpMocks.terminateAcpSession,
  };
});

vi.mock("@mobrienv/autoloop-backends/pi-rpc-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@mobrienv/autoloop-backends/pi-rpc-client")
    >();
  return {
    ...actual,
    initPiSession: piMocks.initPiSession,
    resetPiSession: piMocks.resetPiSession,
    terminatePiSession: piMocks.terminatePiSession,
    getPiSessionStats: piMocks.getPiSessionStats,
  };
});

import {
  resolveOutcome,
  runIteration,
} from "@mobrienv/autoloop-harness/iteration";

const base = {
  emittedTopic: "",
  allTopics: [] as string[],
  hadInvalidEvents: false,
  output: "",
  completionEvent: "task.complete",
  requiredEvents: [] as string[],
  completionPromise: "",
};

function makeAcpLoop(): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-iteration-acp-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "run-memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  return {
    objective: "Use ACP",
    topology: {
      name: "",
      completion: "",
      roles: [],
      handoff: {},
      handoffKeys: [],
    },
    limits: { maxIterations: 1 },
    completion: {
      promise: "DONE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: "acp",
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      promptMode: "acp",
      timeoutMs: 1234,
      trustAllTools: true,
      agent: "reviewer",
      model: "sonnet",
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
      runId: "run-acp",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      configOverride: {},
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
    acpSession: { current: undefined },
    piSession: { current: undefined },
  };
}

function makePiLoop(): LoopContext {
  const loop = makeAcpLoop();
  loop.objective = "Use pi";
  loop.runtime.runId = "run-pi";
  loop.backend = {
    kind: "pi",
    provider: "",
    command: "pi",
    args: ["--thinking", "high"],
    promptMode: "arg",
    timeoutMs: 4321,
    trustAllTools: true,
    agent: "",
    model: "gpt-5",
  };
  return loop;
}

describe("runIteration ACP provider execution", () => {
  it("starts a fresh ACP session from iter.backend and runs the generic ACP runner", async () => {
    const loop = makeAcpLoop();
    const fakeSession = {
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession;
    acpMocks.initAcpSession.mockResolvedValue(fakeSession);
    acpMocks.runAcpIteration.mockResolvedValue({
      output: "DONE",
      exitCode: 0,
      timedOut: false,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(acpMocks.initAcpSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-agent-acp",
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp"],
        cwd: loop.paths.workDir,
        trustAllTools: true,
        agentName: "reviewer",
        modelId: "sonnet",
      }),
    );
    expect(acpMocks.runAcpIteration).toHaveBeenCalledWith(
      fakeSession,
      expect.stringContaining("Use ACP"),
      1234,
    );
    expect(summary.stopReason).toBe("completion_promise");
  });
});

describe("runIteration pi RPC execution", () => {
  beforeEach(() => {
    piMocks.initPiSession.mockReset();
    piMocks.resetPiSession.mockReset();
    piMocks.terminatePiSession.mockReset();
    piMocks.runPiIteration.mockReset();
    piMocks.getPiSessionStats.mockReset();
    piMocks.getPiSessionStats.mockResolvedValue(undefined);
    piMocks.runPiIteration.mockResolvedValue({
      output: "DONE",
      exitCode: 0,
      timedOut: false,
    });
  });

  it("starts a pi RPC session from iter.backend and runs the pi runner", async () => {
    const loop = makePiLoop();
    const fakeSession = { process: { pid: 99 } } as unknown as PiSession;
    piMocks.initPiSession.mockResolvedValue(fakeSession);

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(piMocks.initPiSession).toHaveBeenCalledWith({
      command: "pi",
      args: ["--thinking", "high"],
      cwd: loop.paths.workDir,
      modelId: "gpt-5",
      verbose: false,
    });
    expect(piMocks.runPiIteration).toHaveBeenCalledWith(
      fakeSession,
      expect.stringContaining("Use pi"),
      4321,
      expect.stringContaining("pi-stream.1.jsonl"),
    );
    expect(loop.piSession.current).toBe(fakeSession);
    expect(summary.stopReason).toBe("completion_promise");
  });

  it("journals a backend.usage event when pi reports session stats", async () => {
    const loop = makePiLoop();
    loop.piSession.current = { process: { pid: 99 } } as unknown as PiSession;
    piMocks.resetPiSession.mockResolvedValue(undefined);
    piMocks.getPiSessionStats.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      totalTokens: 152,
      costUsd: 0.42,
      contextPercent: 31,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain('"topic": "backend.usage"');
    expect(journal).toContain('"total_tokens": 152');
    expect(journal).toContain('"cost_usd": 0.42');
    expect(journal).toContain('"context_percent": 31');
    // backend.usage is a system topic — it must never be mistaken for the
    // agent's emitted event, which would invalidate the iteration.
    expect(journal).not.toContain('"topic": "event.invalid"');
    expect(summary.stopReason).toBe("completion_promise");
  });

  it("reuses the live session via new_session instead of respawning", async () => {
    const loop = makePiLoop();
    const liveSession = { process: { pid: 99 } } as unknown as PiSession;
    loop.piSession.current = liveSession;
    piMocks.resetPiSession.mockResolvedValue(undefined);

    await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(piMocks.resetPiSession).toHaveBeenCalledWith(liveSession);
    expect(piMocks.initPiSession).not.toHaveBeenCalled();
    expect(piMocks.runPiIteration).toHaveBeenCalledWith(
      liveSession,
      expect.any(String),
      4321,
      expect.any(String),
    );
  });

  it("terminates and respawns when the session reset fails", async () => {
    const loop = makePiLoop();
    const deadSession = { process: { pid: 99 } } as unknown as PiSession;
    const freshSession = { process: { pid: 100 } } as unknown as PiSession;
    loop.piSession.current = deadSession;
    piMocks.resetPiSession.mockRejectedValue(new Error("process gone"));
    piMocks.terminatePiSession.mockRejectedValue(new Error("already dead"));
    piMocks.initPiSession.mockResolvedValue(freshSession);

    await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(piMocks.terminatePiSession).toHaveBeenCalledWith(deadSession);
    expect(piMocks.initPiSession).toHaveBeenCalledTimes(1);
    expect(loop.piSession.current).toBe(freshSession);
    expect(piMocks.runPiIteration).toHaveBeenCalledWith(
      freshSession,
      expect.any(String),
      4321,
      expect.any(String),
    );
  });
});

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
