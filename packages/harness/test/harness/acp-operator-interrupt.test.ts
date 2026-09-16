import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopContext } from "../../src/types.js";

const acpMocks = vi.hoisted(() => ({
  initAcpSession: vi.fn(),
  terminateAcpSession: vi.fn(),
  sendAcpPrompt: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-backends/acp-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@mobrienv/autoloop-backends/acp-client")
    >();
  return {
    ...actual,
    initAcpSession: acpMocks.initAcpSession,
    terminateAcpSession: acpMocks.terminateAcpSession,
    sendAcpPrompt: acpMocks.sendAcpPrompt,
  };
});

import { runIteration } from "@mobrienv/autoloop-harness/iteration";
import { drainControlRequests } from "../../src/control/dispatch.js";
import {
  appendRequest,
  buildRequest,
  readStatuses,
} from "../../src/control/queue.js";
import { buildControlAdapter } from "../../src/index.js";

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
      gates: [],
      stages: [],
    },
    limits: { maxIterations: 1 },
    completion: {
      promise: "DONE",
      event: "task.complete",
      requiredEvents: [],
      mustBeLast: false,
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
    policy: {
      fileModAudit: false,
      frozenPaths: [],
      frozenPathsBlock: false,
    },
    ask: { enabled: false, event: "human.ask", timeoutMs: 0, pollMs: 0 },
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
      disallowedTools: [],
      usageFrom: "",
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
    stage: { concurrency: 1, branchTimeoutMs: 0 },
    hooks: {
      preRun: "",
      preIteration: "",
      postIteration: "",
      postRun: "",
      strict: false,
      specs: [],
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
    claudeSdkSession: { current: undefined },
    commandSession: { current: undefined },
  };
}

// T-035: operator SIGINT closes the pending ACP turn as interrupted;
// an unrequested close remains a backend failure.

describe("runIteration ACP operator guide interrupt", () => {
  let killSpy: MockInstance<typeof process.kill>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it.each([
    true,
    false,
  ] as const)("applies operator guide interrupt=%s during a pending ACP prompt", async (interrupt) => {
    acpMocks.sendAcpPrompt.mockReset();
    const loop = makeAcpLoop();
    const fakeSession = {
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession;
    acpMocks.initAcpSession.mockResolvedValue(fakeSession);

    // Mock only the ACP transport (sendAcpPrompt) so the REAL
    // runAcpIteration wrapper in @mobrienv/autoloop-backends runs. That
    // wrapper is where the error field is flattened away: it maps
    // result.error to exitCode=1 / errorCategory="non_zero_exit" and drops
    // the message, so the harness would classify the interrupt close as a
    // backend failure instead of "interrupted" without the shared-holder
    // flag consumed by runIteration.
    let resolvePrompt: (v: {
      output: string;
      error?: string;
      timedOut: boolean;
    }) => void = () => {};
    const pendingPrompt = new Promise<{
      output: string;
      error?: string;
      timedOut: boolean;
    }>((resolve) => {
      resolvePrompt = resolve;
    });
    acpMocks.sendAcpPrompt.mockReturnValue(pendingPrompt);

    // Wire the control adapter exactly as the harness does: the hook is
    // invoked by drainControlRequests while the prompt is pending.
    const adapter = buildControlAdapter(loop);

    // Queue the operator guide request before the iteration starts.
    const request = buildRequest(
      loop.runtime.runId,
      "guide",
      { message: "stop and re-read the objective", interrupt },
      "operator interrupt test",
    );
    appendRequest(loop.paths.stateDir, request);

    try {
      // The loop must never recurse past iteration 1 here: a retry bug
      // (interrupt misclassified as a retryable failure) would surface as
      // this throw, not as a silently wrong stop reason.
      const iterationPromise = runIteration(loop, 1, async () => {
        throw new Error("unexpected recursion");
      });

      // Wait until the ACP prompt is actually pending, then drain control
      // requests through the adapter hook (guide interrupt path).
      await vi.waitFor(() => {
        expect(acpMocks.sendAcpPrompt).toHaveBeenCalled();
      });
      if (!adapter) throw new Error("missing ACP adapter");
      drainControlRequests(loop.paths.stateDir, adapter);

      if (interrupt) {
        // Interrupt: the adapter must SIGINT the ACP session process group;
        // the mocked kill (no real signals) lets the pending prompt resolve
        // with the connection-closed error, mirroring sendAcpPromptOnce's
        // crashPromise catch which returns error as a result field.
        expect(killSpy).toHaveBeenCalledWith(-1234, "SIGINT");
        resolvePrompt({
          output: "",
          error: "ACP connection closed",
          timedOut: false,
        });
      } else {
        // No interrupt: kill must never be called and the flag must stay
        // unset; prompt completes DONE.
        expect(killSpy).not.toHaveBeenCalled();
        resolvePrompt({ output: "DONE", timedOut: false });
      }

      const summary = await iterationPromise;

      // Statuses must be applied to the control queue either way.
      const statuses = readStatuses(loop.paths.stateDir);
      expect(statuses[0]?.state).toBe("applied");
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses[0]?.id).toBe(request.id);

      if (interrupt) {
        // The operator-requested interrupt must surface as `interrupted`,
        // not backend_failed, even though the backend wrapper flattened the
        // close into a non-zero exit.
        expect(summary.stopReason).toBe("interrupted");
        const journal = readFileSync(loop.paths.journalFile, "utf-8");
        expect(journal).toContain('"reason": "interrupted"');
      } else {
        // No interrupt: the DONE output completes via the completion
        // promise and the loop never stops as interrupted.
        expect(summary.stopReason).toBe("completion_promise");
      }
    } finally {
      rmSync(loop.paths.workDir, { recursive: true, force: true });
    }
  });

  it("does not fabricate an interrupted stop when the kill throws", async () => {
    acpMocks.sendAcpPrompt.mockReset();
    const loop = makeAcpLoop();
    const fakeSession = {
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession;
    acpMocks.initAcpSession.mockResolvedValue(fakeSession);

    let resolvePrompt: (v: {
      output: string;
      error?: string;
      timedOut: boolean;
    }) => void = () => {};
    const pendingPrompt = new Promise<{
      output: string;
      error?: string;
      timedOut: boolean;
    }>((resolve) => {
      resolvePrompt = resolve;
    });
    acpMocks.sendAcpPrompt.mockReturnValue(pendingPrompt);

    killSpy.mockImplementation(() => {
      throw new Error("kill failed");
    });

    const adapter = buildControlAdapter(loop);
    const request = buildRequest(
      loop.runtime.runId,
      "guide",
      { message: "stop", interrupt: true },
      "operator interrupt kill-throws test",
    );
    appendRequest(loop.paths.stateDir, request);

    try {
      const iterationPromise = runIteration(loop, 1, async () => {
        throw new Error("unexpected recursion");
      });

      await vi.waitFor(() => {
        expect(acpMocks.sendAcpPrompt).toHaveBeenCalled();
      });
      if (!adapter) throw new Error("missing ACP adapter");
      drainControlRequests(loop.paths.stateDir, adapter);

      // The signal failed, so the flag must be restored (not left true) and
      // the turn completes normally via the completion promise.
      resolvePrompt({ output: "DONE", timedOut: false });

      const summary = await iterationPromise;
      expect(summary.stopReason).toBe("completion_promise");
    } finally {
      killSpy.mockRestore();
      rmSync(loop.paths.workDir, { recursive: true, force: true });
    }
  });

  it("classifies an unexpected ACP close with no operator interrupt as backend_failed", async () => {
    acpMocks.sendAcpPrompt.mockReset();
    const loop = makeAcpLoop();
    const fakeSession = {
      provider: { id: "claude-agent-acp" },
      process: { pid: 1234 },
    } as unknown as AcpSession;
    acpMocks.initAcpSession.mockResolvedValue(fakeSession);

    let resolvePrompt: (v: {
      output: string;
      error?: string;
      timedOut: boolean;
    }) => void = () => {};
    const pendingPrompt = new Promise<{
      output: string;
      error?: string;
      timedOut: boolean;
    }>((resolve) => {
      resolvePrompt = resolve;
    });
    acpMocks.sendAcpPrompt.mockReturnValue(pendingPrompt);

    try {
      const iterationPromise = runIteration(loop, 1, async () => {
        throw new Error("unexpected recursion");
      });

      await vi.waitFor(() => {
        expect(acpMocks.sendAcpPrompt).toHaveBeenCalled();
      });

      // No control request is queued and no interrupt is signaled: the
      // backend simply closes with an error. The harness must classify this
      // as a backend failure (the real runAcpIteration wrapper flattens the
      // error field into a non-zero exit), not as an interrupted stop.
      expect(killSpy).not.toHaveBeenCalled();
      resolvePrompt({
        output: "",
        error: "ACP connection closed",
        timedOut: false,
      });

      const summary = await iterationPromise;
      expect(summary.stopReason).toBe("backend_failed");
    } finally {
      rmSync(loop.paths.workDir, { recursive: true, force: true });
    }
  });
});
