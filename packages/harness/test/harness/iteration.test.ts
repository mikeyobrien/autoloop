import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it, vi } from "vitest";

const acpMocks = vi.hoisted(() => ({
  initAcpSession: vi.fn(),
  terminateAcpSession: vi.fn(),
  runAcpIteration: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-backends", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-backends")>();
  return { ...actual, runAcpIteration: acpMocks.runAcpIteration };
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
  };
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
