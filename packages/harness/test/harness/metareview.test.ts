import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import {
  runMetareviewReview,
  shouldRunMetareview,
} from "@mobrienv/autoloop-harness/metareview";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it, vi } from "vitest";

const backendMocks = vi.hoisted(() => ({
  runAcpIteration: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-backends", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-backends")>();
  return { ...actual, runAcpIteration: backendMocks.runAcpIteration };
});

function makeLoop(
  enabled: boolean,
  every: number,
  adversarialFirst = false,
): LoopContext {
  return {
    review: {
      enabled,
      every,
      adversarialFirst,
      kind: "command",
      provider: "",
      command: "echo",
      args: [],
      promptMode: "arg",
      prompt: "",
      timeoutMs: 5000,
      trustAllTools: true,
      agent: "",
      model: "",
    },
  } as unknown as LoopContext;
}

function makeAcpReviewLoop(): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-metareview-acp-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "run-memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  return {
    objective: "test",
    topology: {
      name: "",
      completion: "",
      roles: [],
      handoff: {},
      handoffKeys: [],
    },
    backend: {
      kind: "acp",
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      promptMode: "acp",
      timeoutMs: 1000,
      trustAllTools: true,
      agent: "",
      model: "",
    },
    review: {
      enabled: true,
      every: 1,
      adversarialFirst: true,
      kind: "acp",
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      promptMode: "acp",
      prompt: "review this",
      timeoutMs: 4321,
      trustAllTools: true,
      agent: "reviewer",
      model: "sonnet",
    },
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
    memory: { budgetChars: 1000 },
    tasks: { budgetChars: 1000 },
    profiles: { active: [], fragments: new Map(), warnings: [] },
    completion: { promise: "DONE", event: "task.complete", requiredEvents: [] },
    limits: { maxIterations: 3 },
    parallel: { enabled: false, maxBranches: 0, branchTimeoutMs: 0 },
    harness: { instructions: "" },
    runtime: {
      runId: "run-review-acp",
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
    kiroSession: {
      provider: { id: "claude-agent-acp" },
    } as unknown as AcpSession,
  };
}

describe("shouldRunMetareview", () => {
  it("returns false when review is disabled", () => {
    expect(shouldRunMetareview(makeLoop(false, 1), 5)).toBe(false);
  });

  it("returns false on iteration 1 even if enabled", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 1)).toBe(false);
  });

  it("returns false on iteration 1 even when adversarial first review is enabled", () => {
    expect(shouldRunMetareview(makeLoop(true, 4, true), 1)).toBe(false);
  });

  it("runs adversarial first review before iteration 2 so iteration 1 output exists", () => {
    expect(shouldRunMetareview(makeLoop(true, 4, true), 2)).toBe(true);
  });

  it("returns true on iteration 2 with every=1", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 2)).toBe(true);
  });

  it("returns true on iteration 3 with every=1", () => {
    expect(shouldRunMetareview(makeLoop(true, 1), 3)).toBe(true);
  });

  it("returns false on iteration 2 with every=3", () => {
    // (2-1) % 3 === 1, not 0
    expect(shouldRunMetareview(makeLoop(true, 3), 2)).toBe(false);
  });

  it("returns false on iteration 3 with every=3", () => {
    // (3-1) % 3 === 2, not 0
    expect(shouldRunMetareview(makeLoop(true, 3), 3)).toBe(false);
  });

  it("returns true on iteration 4 with every=3", () => {
    // (4-1) % 3 === 0
    expect(shouldRunMetareview(makeLoop(true, 3), 4)).toBe(true);
  });

  it("returns true on iteration 7 with every=3", () => {
    // (7-1) % 3 === 0
    expect(shouldRunMetareview(makeLoop(true, 3), 7)).toBe(true);
  });

  it("returns true on iteration 6 with every=5", () => {
    // (6-1) % 5 === 0
    expect(shouldRunMetareview(makeLoop(true, 5), 6)).toBe(true);
  });

  it("returns false on iteration 5 with every=5", () => {
    // (5-1) % 5 === 4
    expect(shouldRunMetareview(makeLoop(true, 5), 5)).toBe(false);
  });
});

describe("runMetareviewReview", () => {
  it("uses the generic ACP runner for ACP review backends", async () => {
    const loop = makeAcpReviewLoop();
    backendMocks.runAcpIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"CONTINUE","confidence":0.8,"reasoning":"ok"}\n```',
      exitCode: 0,
      timedOut: false,
    });

    const verdict = await runMetareviewReview(loop, 2);

    expect(backendMocks.runAcpIteration).toHaveBeenCalledWith(
      loop.kiroSession,
      expect.stringContaining("You are the metareview meta-reviewer"),
      4321,
    );
    expect(verdict.verdict).toBe("CONTINUE");
  });
});
