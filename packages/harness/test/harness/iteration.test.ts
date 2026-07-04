import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { PiSession } from "@mobrienv/autoloop-backends/pi-rpc-client";
import { encodeEvent } from "@mobrienv/autoloop-core";
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
  hasBlockingTasks: false,
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
    hooks: {
      preRun: "",
      preIteration: "",
      postIteration: "",
      postRun: "",
      strict: false,
    },
    parallel: {
      enabled: false,
      maxBranches: 0,
      branchTimeoutMs: 0,
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

  const noGuards = {
    assertNoTodo: false,
    assertNoSkippedTests: false,
    assertNoSecrets: false,
    assertCleanTree: false,
    screenTestTamper: false,
    criteria: [] as string[],
  };

  it("parks then holds completion when the acceptance gate fails", async () => {
    const loop = makeAcpLoop();
    loop.acceptance = { verifyCmds: ["false"], timeoutMs: 30000, ...noGuards };
    acpMocks.initAcpSession.mockResolvedValue({
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession);
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

    // Done-claim met the promise, parked, but the failing verify_cmd holds it.
    expect(summary.stopReason).toBe("continued");
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain('"state": "awaiting_acceptance"');
    expect(journal).toContain('"state": "held"');
    expect(journal).not.toContain('"state": "accepted"');
  });

  it("maps a 429 backend error to a typed rate_limited stop (breaker open)", async () => {
    const loop = makeAcpLoop();
    // Open the breaker immediately so the run stops without pausing.
    loop.limits = { ...loop.limits, transientMaxPauses: 0 };
    acpMocks.initAcpSession.mockResolvedValue({
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession);
    acpMocks.runAcpIteration.mockResolvedValue({
      output: "HTTP 429 Too Many Requests: rate limit exceeded",
      exitCode: 1,
      timedOut: false,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(summary.stopReason).toBe("rate_limited");
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain('"reason": "rate_limited"');
  });

  it("retries a transient error with backoff (continues) instead of dying", async () => {
    const loop = makeAcpLoop();
    // Allow retries; base 0 → no real sleep in the test.
    loop.limits = {
      ...loop.limits,
      transientMaxPauses: 3,
      transientPauseMs: 0,
    };
    acpMocks.initAcpSession.mockResolvedValue({
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession);
    acpMocks.runAcpIteration.mockResolvedValue({
      output: "503 Service Unavailable",
      exitCode: 1,
      timedOut: false,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    // Not a death: the transient blip is retried (loop continues).
    expect(summary.stopReason).toBe("continued");
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain("backend.transient");
    expect(journal).toContain('"error_class": "transient_error"');
  });

  it("parks then releases completion when the acceptance gate passes", async () => {
    const loop = makeAcpLoop();
    loop.acceptance = { verifyCmds: ["true"], timeoutMs: 30000, ...noGuards };
    acpMocks.initAcpSession.mockResolvedValue({
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession);
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

    expect(summary.stopReason).toBe("completion_promise");
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain('"state": "awaiting_acceptance"');
    expect(journal).toContain('"state": "accepted"');
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

describe("runIteration loop runtime budget clamp", () => {
  beforeEach(() => {
    piMocks.resetPiSession.mockReset();
    piMocks.runPiIteration.mockReset();
    piMocks.getPiSessionStats.mockReset();
    piMocks.getPiSessionStats.mockResolvedValue(undefined);
  });

  function makeBudgetLoop(
    maxRuntimeMs: number,
    elapsedMs: number,
  ): LoopContext {
    const loop = makePiLoop();
    loop.limits = { maxIterations: 5, maxRuntimeMs };
    loop.piSession.current = { process: { pid: 99 } } as unknown as PiSession;
    piMocks.resetPiSession.mockResolvedValue(undefined);
    const createdAt = new Date(Date.now() - elapsedMs).toISOString();
    writeFileSync(
      loop.paths.journalFile,
      `${encodeEvent({
        shape: "fields",
        run: loop.runtime.runId,
        iteration: "",
        topic: "loop.start",
        fields: { max_iterations: "5", created_at: createdAt },
      })}\n`,
    );
    return loop;
  }

  it("clamps the journaled backend timeout to the remaining loop budget", async () => {
    // 8s of a 10s budget elapsed: remaining ~2s is below the 4321ms timeout.
    const loop = makeBudgetLoop(10_000, 8_000);
    piMocks.runPiIteration.mockResolvedValue({
      output: "DONE",
      exitCode: 0,
      timedOut: false,
    });

    await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    const effectiveTimeout = piMocks.runPiIteration.mock.calls[0][2];
    expect(effectiveTimeout).toBeGreaterThan(0);
    expect(effectiveTimeout).toBeLessThan(4321);
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain(`"timeout_ms": "${effectiveTimeout}"`);
  });

  it("journals max_runtime when a budget-clamped iteration times out", async () => {
    const loop = makeBudgetLoop(10_000, 8_000);
    piMocks.runPiIteration.mockResolvedValue({
      output: "partial work",
      exitCode: 1,
      timedOut: true,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(summary.stopReason).toBe("max_runtime");
    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    expect(journal).toContain('"reason": "max_runtime"');
    expect(journal).toContain('"max_runtime_ms": "10000"');
    expect(journal).toContain('"output_tail": "partial work"');
  });

  it("keeps backend_timeout when the per-iteration limit was the binding constraint", async () => {
    // Plenty of loop budget left: the 4321ms backend timeout is unclamped.
    const loop = makeBudgetLoop(600_000, 1_000);
    piMocks.runPiIteration.mockResolvedValue({
      output: "slow",
      exitCode: 1,
      timedOut: true,
    });

    const summary = await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(summary.stopReason).toBe("backend_timeout");
    expect(piMocks.runPiIteration).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      4321,
      expect.any(String),
    );
  });

  it("does not clamp when no runtime budget is configured", async () => {
    const loop = makeBudgetLoop(0, 8_000);
    piMocks.runPiIteration.mockResolvedValue({
      output: "DONE",
      exitCode: 0,
      timedOut: false,
    });

    await runIteration(loop, 1, async () => ({
      iterations: 1,
      stopReason: "continued",
      runId: loop.runtime.runId,
    }));

    expect(piMocks.runPiIteration).toHaveBeenCalledWith(
      expect.anything(),
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

  it("does not complete via promise when required events are unmet", () => {
    const result = resolveOutcome({
      ...base,
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
      requiredEvents: ["verify.done"],
      allTopics: [],
    });
    expect(result).toEqual({ action: "continue", outcome: "continue" });
  });

  it("completes via promise once required events are satisfied", () => {
    const result = resolveOutcome({
      ...base,
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
      requiredEvents: ["verify.done"],
      allTopics: ["verify.done"],
    });
    expect(result).toEqual({
      action: "complete_promise",
      outcome: "complete:completion_promise",
    });
  });

  it("does not complete via promise when blocking tasks remain open", () => {
    const result = resolveOutcome({
      ...base,
      output: "LOOP_COMPLETE",
      completionPromise: "LOOP_COMPLETE",
      hasBlockingTasks: true,
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
