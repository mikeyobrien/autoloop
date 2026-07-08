import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { PiSession } from "@mobrienv/autoloop-backends/pi-rpc-client";
import {
  parseVerdict,
  runMetareviewReview,
  shouldRunMetareview,
} from "@mobrienv/autoloop-harness/metareview";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it, vi } from "vitest";

const backendMocks = vi.hoisted(() => ({
  runAcpIteration: vi.fn(),
  initAcpSession: vi.fn(),
  terminateAcpSession: vi.fn(),
  runPiIteration: vi.fn(),
  initPiSession: vi.fn(),
  terminatePiSession: vi.fn(),
}));

vi.mock("@mobrienv/autoloop-backends", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-backends")>();
  return {
    ...actual,
    runAcpIteration: backendMocks.runAcpIteration,
    runPiIteration: backendMocks.runPiIteration,
  };
});

vi.mock("@mobrienv/autoloop-backends/pi-rpc-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@mobrienv/autoloop-backends/pi-rpc-client")
    >();
  return {
    ...actual,
    initPiSession: backendMocks.initPiSession,
    terminatePiSession: backendMocks.terminatePiSession,
  };
});

vi.mock("@mobrienv/autoloop-backends/acp-client", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@mobrienv/autoloop-backends/acp-client")
    >();
  return {
    ...actual,
    initAcpSession: backendMocks.initAcpSession,
    terminateAcpSession: backendMocks.terminateAcpSession,
  };
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
      onError: "hold",
      minConfidence: 0.5,
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
    parallel: {
      enabled: false,
      maxBranches: 0,
      branchTimeoutMs: 0,
      aggregate: { mode: "wait_for_all", timeoutMs: 0 },
    },
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
    acpSession: {
      current: {
        provider: { id: "claude-agent-acp" },
      } as unknown as AcpSession,
    },
    piSession: { current: undefined },
  };
}

function makePiReviewLoop(): LoopContext {
  const loop = makeAcpReviewLoop();
  loop.runtime.runId = "run-review-pi";
  loop.review = {
    ...loop.review,
    kind: "pi",
    provider: "",
    command: "pi",
    args: ["--thinking", "high"],
    promptMode: "arg",
    model: "gpt-5",
    agent: "",
  };
  loop.piSession = {
    current: { process: { pid: 7 } } as unknown as PiSession,
  };
  return loop;
}

describe("parseVerdict (fail-closed)", () => {
  const block = (obj: Record<string, unknown>) =>
    "```json\n" + JSON.stringify(obj) + "\n```";

  it("returns a well-formed verdict verbatim", () => {
    const v = parseVerdict(
      block({ verdict: "EXIT", confidence: 0.9, reasoning: "done" }),
    );
    expect(v.verdict).toBe("EXIT");
    expect(v.confidence).toBe(0.9);
  });

  it("fails closed to UNKNOWN on empty output", () => {
    expect(parseVerdict("").verdict).toBe("UNKNOWN");
    expect(parseVerdict("   \n ").verdict).toBe("UNKNOWN");
  });

  it("fails closed to UNKNOWN when no verdict block is present", () => {
    expect(parseVerdict("just some prose, no json").verdict).toBe("UNKNOWN");
  });

  it("fails closed to UNKNOWN on malformed JSON", () => {
    expect(parseVerdict("```json\n{ not valid json }\n```").verdict).toBe(
      "UNKNOWN",
    );
  });

  it("fails closed to UNKNOWN on an unrecognized verdict kind", () => {
    expect(
      parseVerdict(block({ verdict: "MAYBE", confidence: 1 })).verdict,
    ).toBe("UNKNOWN");
  });

  it("fails closed to UNKNOWN when the verdict field is missing", () => {
    expect(parseVerdict(block({ confidence: 1, reasoning: "x" })).verdict).toBe(
      "UNKNOWN",
    );
  });

  it("downgrades a below-threshold verdict to UNKNOWN", () => {
    const v = parseVerdict(
      block({ verdict: "CONTINUE", confidence: 0.2, reasoning: "meh" }),
      0.5,
    );
    expect(v.verdict).toBe("UNKNOWN");
    expect(v.confidence).toBe(0.2);
  });

  it("keeps an at-or-above-threshold verdict", () => {
    expect(
      parseVerdict(block({ verdict: "CONTINUE", confidence: 0.5 }), 0.5)
        .verdict,
    ).toBe("CONTINUE");
  });

  it("does not gate on confidence when threshold is 0", () => {
    expect(
      parseVerdict(block({ verdict: "CONTINUE", confidence: 0 }), 0).verdict,
    ).toBe("CONTINUE");
  });
});

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
  function mockAcpReviewRun(): AcpSession {
    const reviewSession = {
      provider: { id: "claude-agent-acp" },
    } as unknown as AcpSession;
    backendMocks.initAcpSession.mockReset();
    backendMocks.terminateAcpSession.mockReset();
    backendMocks.runAcpIteration.mockReset();
    backendMocks.initAcpSession.mockResolvedValue(reviewSession);
    backendMocks.terminateAcpSession.mockResolvedValue(undefined);
    backendMocks.runAcpIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"CONTINUE","confidence":0.8,"reasoning":"ok"}\n```',
      exitCode: 0,
      timedOut: false,
    });
    return reviewSession;
  }

  it("runs ACP reviews in a dedicated session built from the review spec", async () => {
    const loop = makeAcpReviewLoop();
    const reviewSession = mockAcpReviewRun();

    const verdict = await runMetareviewReview(loop, 2);

    expect(backendMocks.initAcpSession).toHaveBeenCalledWith({
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      cwd: loop.paths.workDir,
      trustAllTools: true,
      agentName: "reviewer",
      modelId: "sonnet",
      verbose: false,
    });
    expect(backendMocks.runAcpIteration).toHaveBeenCalledWith(
      reviewSession,
      expect.stringContaining("You are the metareview meta-reviewer"),
      4321,
    );
    expect(verdict.verdict).toBe("CONTINUE");
  });

  it("does not reuse the live iteration session for ACP reviews", async () => {
    const loop = makeAcpReviewLoop();
    const reviewSession = mockAcpReviewRun();

    await runMetareviewReview(loop, 2);

    const [usedSession] = backendMocks.runAcpIteration.mock.calls[0];
    expect(usedSession).toBe(reviewSession);
    expect(usedSession).not.toBe(loop.acpSession.current);
  });

  it("runs ACP reviews even when no iteration session is live", async () => {
    const loop = makeAcpReviewLoop();
    loop.acpSession.current = undefined;
    mockAcpReviewRun();

    const verdict = await runMetareviewReview(loop, 2);

    expect(backendMocks.initAcpSession).toHaveBeenCalledTimes(1);
    expect(verdict.verdict).toBe("CONTINUE");
  });

  it("terminates the review session after the verdict, even on failure", async () => {
    const loop = makeAcpReviewLoop();
    const reviewSession = mockAcpReviewRun();
    backendMocks.runAcpIteration.mockRejectedValue(new Error("boom"));

    await expect(runMetareviewReview(loop, 2)).rejects.toThrow("boom");
    expect(backendMocks.terminateAcpSession).toHaveBeenCalledWith(
      reviewSession,
    );
  });

  it("quarantines a verdict produced under a transient (429) reviewer error", async () => {
    const loop = makeAcpReviewLoop();
    mockAcpReviewRun();
    // The reviewer hit a rate limit and exited non-zero — never fold an outage
    // into a confident verdict.
    backendMocks.runAcpIteration.mockResolvedValue({
      output: "HTTP 429 Too Many Requests: rate limit exceeded",
      exitCode: 1,
      timedOut: false,
    });

    const verdict = await runMetareviewReview(loop, 2);
    expect(verdict.verdict).toBe("UNKNOWN");
  });

  it("does not quarantine an ordinary non-zero reviewer exit with a valid verdict", async () => {
    const loop = makeAcpReviewLoop();
    mockAcpReviewRun();
    // Non-zero exit but the output is a clean, confident verdict (no transient
    // signature) → parsed normally, not quarantined.
    backendMocks.runAcpIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"EXIT","confidence":0.9,"reasoning":"done"}\n```',
      exitCode: 1,
      timedOut: false,
    });

    const verdict = await runMetareviewReview(loop, 2);
    expect(verdict.verdict).toBe("EXIT");
  });

  function mockPiReviewRun(): PiSession {
    const reviewSession = { process: { pid: 8 } } as unknown as PiSession;
    backendMocks.initPiSession.mockReset();
    backendMocks.terminatePiSession.mockReset();
    backendMocks.runPiIteration.mockReset();
    backendMocks.initPiSession.mockResolvedValue(reviewSession);
    backendMocks.terminatePiSession.mockResolvedValue(undefined);
    backendMocks.runPiIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"CONTINUE","confidence":0.8,"reasoning":"ok"}\n```',
      exitCode: 0,
      timedOut: false,
    });
    return reviewSession;
  }

  it("runs pi reviews in a dedicated RPC session built from the review spec", async () => {
    const loop = makePiReviewLoop();
    const reviewSession = mockPiReviewRun();

    const verdict = await runMetareviewReview(loop, 2);

    expect(backendMocks.initPiSession).toHaveBeenCalledWith({
      command: "pi",
      args: ["--thinking", "high"],
      cwd: loop.paths.workDir,
      modelId: "gpt-5",
      verbose: false,
    });
    expect(backendMocks.runPiIteration).toHaveBeenCalledWith(
      reviewSession,
      expect.stringContaining("You are the metareview meta-reviewer"),
      4321,
      expect.stringContaining("pi-review.2.jsonl"),
    );
    expect(verdict.verdict).toBe("CONTINUE");
  });

  it("does not reuse the live pi iteration session for reviews", async () => {
    const loop = makePiReviewLoop();
    const reviewSession = mockPiReviewRun();

    await runMetareviewReview(loop, 2);

    const [usedSession] = backendMocks.runPiIteration.mock.calls[0];
    expect(usedSession).toBe(reviewSession);
    expect(usedSession).not.toBe(loop.piSession.current);
  });

  it("terminates the pi review session after the verdict, even on failure", async () => {
    const loop = makePiReviewLoop();
    const reviewSession = mockPiReviewRun();
    backendMocks.runPiIteration.mockRejectedValue(new Error("boom"));

    await expect(runMetareviewReview(loop, 2)).rejects.toThrow("boom");
    expect(backendMocks.terminatePiSession).toHaveBeenCalledWith(reviewSession);
  });

  it("fails closed to UNKNOWN when the review times out (never CONTINUE)", async () => {
    const loop = makeAcpReviewLoop();
    mockAcpReviewRun();
    backendMocks.runAcpIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"CONTINUE","confidence":0.9,"reasoning":"partial"}\n```',
      exitCode: 0,
      timedOut: true,
    });

    const verdict = await runMetareviewReview(loop, 2);

    expect(verdict.verdict).toBe("UNKNOWN");
  });

  it("fails closed to UNKNOWN on malformed review output (never CONTINUE)", async () => {
    const loop = makeAcpReviewLoop();
    mockAcpReviewRun();
    backendMocks.runAcpIteration.mockResolvedValue({
      output: "no structured verdict here",
      exitCode: 0,
      timedOut: false,
    });

    const verdict = await runMetareviewReview(loop, 2);

    expect(verdict.verdict).toBe("UNKNOWN");
  });

  it("downgrades a below-threshold review verdict to UNKNOWN", async () => {
    const loop = makeAcpReviewLoop();
    loop.review.minConfidence = 0.7;
    mockAcpReviewRun();
    backendMocks.runAcpIteration.mockResolvedValue({
      output:
        '```json\n{"verdict":"EXIT","confidence":0.3,"reasoning":"unsure"}\n```',
      exitCode: 0,
      timedOut: false,
    });

    const verdict = await runMetareviewReview(loop, 2);

    expect(verdict.verdict).toBe("UNKNOWN");
  });
});
