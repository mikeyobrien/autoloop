import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractField,
  extractTopic,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import type { Role } from "@mobrienv/autoloop-core/topology";
import { buildIterationContext } from "@mobrienv/autoloop-harness/prompt";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import {
  AGENT_WAVE_KEY,
  declarativeWaveKey,
  executeDeclarativeWave,
  executeParallelWave,
  isWaveActive,
  listActiveWaves,
  registerActiveWave,
} from "@mobrienv/autoloop-harness/wave";
import { describe, expect, it } from "vitest";

interface FixtureOpts {
  roles?: Role[];
  handoff?: Record<string, string[]>;
  aggregate?: LoopContext["parallel"]["aggregate"];
  maxBranches?: number;
}

function makeLoop(name: string, opts: FixtureOpts = {}): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-wave-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const roles: Role[] = opts.roles ?? [
    {
      id: "reviewer",
      prompt: "Review the change.",
      promptFile: "",
      emits: ["review.done"],
      concurrency: 3,
    },
  ];
  const handoff = opts.handoff ?? { "gaps.identified": ["reviewer"] };

  return {
    objective: "Wave test",
    topology: {
      name: "t",
      completion: "task.complete",
      roles,
      handoff,
      handoffKeys: Object.keys(handoff),
      gates: [],
      stages: [],
    },
    limits: { maxIterations: 5 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: "command",
      provider: "",
      command: "true",
      args: [],
      promptMode: "stdin",
      timeoutMs: 2000,
    },
    review: {
      enabled: false,
      every: 4,
      kind: "command",
      command: "true",
      args: [],
      promptMode: "stdin",
      prompt: "",
      timeoutMs: 1000,
      trustAllTools: false,
      agent: "",
      model: "",
      onError: "hold",
      minConfidence: 0.5,
    },
    parallel: {
      enabled: true,
      maxBranches: opts.maxBranches ?? 5,
      branchTimeoutMs: 5000,
      aggregate: opts.aggregate ?? { mode: "wait_for_all", timeoutMs: 0 },
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
      runId: "run-wave",
      // A trivial self-command: the supervisor invokes
      // `<selfCommand> branch-run <projectDir> <branchDir>`, so "true" just
      // exits 0 immediately without writing a summary.json — branches
      // resolve deterministically to `branch_process_failed`, which is all
      // these tests need (they assert on wave-level bookkeeping, not branch
      // backend success).
      selfCommand: "true",
      promptOverride: null,
      backendOverride: {},
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
  } as unknown as LoopContext;
}

function journalLines(loop: LoopContext): string[] {
  return readRunLines(loop.paths.journalFile, loop.runtime.runId);
}

function findByTopic(lines: string[], topic: string): string {
  const line = lines.find((l) => extractTopic(l) === topic);
  if (line === undefined) {
    throw new Error(`no journal line with topic \`${topic}\` found`);
  }
  return line;
}

describe("declarative concurrent wave launch", () => {
  it("auto-launches N branches for a role with concurrency>0, no agent .parallel emit", () => {
    const loop = makeLoop("declarative-launch");
    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0];

    const result = executeDeclarativeWave(loop, iter, role, "gaps.identified");

    expect(result.source).toBe("declarative");
    expect(result.waveId).toMatch(/^wave-/);

    const lines = journalLines(loop);
    const start = findByTopic(lines, "wave.start");
    expect(extractField(start, "branch_count")).toBe("3");
    expect(extractField(start, "concurrency_source")).toBe("declarative");
    expect(extractField(start, "role_id")).toBe("reviewer");
    expect(extractField(start, "concurrency")).toBe("3");
  });

  it("caps declarative branch count at parallel.max_branches", () => {
    const loop = makeLoop("declarative-cap", { maxBranches: 2 });
    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0]; // concurrency: 3, cap: 2

    executeDeclarativeWave(loop, iter, role, "gaps.identified");

    const lines = journalLines(loop);
    const start = findByTopic(lines, "wave.start");
    expect(extractField(start, "branch_count")).toBe("2");
  });

  it("clears the role's registry slot once the wave joins", () => {
    const loop = makeLoop("declarative-clears");
    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0];

    executeDeclarativeWave(loop, iter, role, "gaps.identified");

    expect(isWaveActive(loop, declarativeWaveKey("reviewer"))).toBe(false);
    expect(listActiveWaves(loop)).toEqual([]);
  });
});

describe("multiple active waves (per-role tracking)", () => {
  it("tracks two distinct wave keys as simultaneously active", () => {
    const loop = makeLoop("multi-active");
    registerActiveWave(loop, AGENT_WAVE_KEY, "wave-agent-1");
    registerActiveWave(loop, declarativeWaveKey("reviewer"), "wave-decl-1");

    const active = listActiveWaves(loop);
    expect(active).toHaveLength(2);
    expect(isWaveActive(loop, AGENT_WAVE_KEY)).toBe(true);
    expect(isWaveActive(loop, declarativeWaveKey("reviewer"))).toBe(true);
  });

  it("clearing one active wave leaves the other tracked", () => {
    const loop = makeLoop("multi-active-clear");
    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0];

    // Pre-register an unrelated agent wave slot so it survives the
    // declarative wave's full lifecycle (register -> run -> clear).
    registerActiveWave(loop, AGENT_WAVE_KEY, "wave-agent-preexisting");

    executeDeclarativeWave(loop, iter, role, "gaps.identified");

    // The declarative wave cleared its own slot on join, but the
    // independently-tracked agent slot must remain untouched.
    expect(isWaveActive(loop, AGENT_WAVE_KEY)).toBe(true);
    expect(isWaveActive(loop, declarativeWaveKey("reviewer"))).toBe(false);
  });
});

describe("mixed agent/declarative wave scenarios", () => {
  it("an active declarative wave for one role does not block an agent-triggered wave", () => {
    const loop = makeLoop("mixed-declarative-blocks-not-agent");
    registerActiveWave(
      loop,
      declarativeWaveKey("reviewer"),
      "wave-decl-active",
    );

    const iter = buildIterationContext(loop, 1);
    const result = executeParallelWave(
      loop,
      iter,
      "explore.parallel",
      "- branch one\n- branch two\n",
    );

    expect(result.reason).not.toBe("parallel_wave_invalid");
    expect(result.source).toBe("agent");
  });

  it("an active agent wave does not block a declarative wave for a different role", () => {
    const loop = makeLoop("mixed-agent-blocks-not-declarative");
    registerActiveWave(loop, AGENT_WAVE_KEY, "wave-agent-active");

    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0];
    const result = executeDeclarativeWave(loop, iter, role, "gaps.identified");

    expect(result.reason).not.toBe("parallel_wave_invalid");
    expect(result.source).toBe("declarative");
  });

  it("rejects a second declarative wave for the SAME role while one is active", () => {
    const loop = makeLoop("mixed-same-role-rejected");
    registerActiveWave(
      loop,
      declarativeWaveKey("reviewer"),
      "wave-decl-active",
    );

    const iter = buildIterationContext(loop, 1);
    const role = loop.topology.roles[0];
    const result = executeDeclarativeWave(loop, iter, role, "gaps.identified");

    expect(result.reason).toBe("parallel_wave_invalid");
    expect(result.waveId).toBe("wave-decl-active");

    const lines = journalLines(loop);
    const invalid = findByTopic(lines, "wave.invalid");
    expect(extractField(invalid, "reason")).toBe("active_wave_exists");
    expect(extractField(invalid, "concurrency_source")).toBe("declarative");
    expect(extractField(invalid, "role_id")).toBe("reviewer");
  });

  it("rejects a second agent-triggered wave while one is active (backward compatible)", () => {
    const loop = makeLoop("mixed-agent-rejected");
    registerActiveWave(loop, AGENT_WAVE_KEY, "wave-agent-active");

    const iter = buildIterationContext(loop, 1);
    const result = executeParallelWave(
      loop,
      iter,
      "explore.parallel",
      "- branch one\n",
    );

    expect(result.reason).toBe("parallel_wave_invalid");
    expect(result.waveId).toBe("wave-agent-active");

    const lines = journalLines(loop);
    const invalid = findByTopic(lines, "wave.invalid");
    expect(extractField(invalid, "concurrency_source")).toBe("agent");
  });
});

describe("declarative wave: no concurrency configured", () => {
  it("does not launch a wave when concurrency is 0 (invalid, empty branch list)", () => {
    const loop = makeLoop("no-concurrency", {
      roles: [
        {
          id: "reviewer",
          prompt: "R",
          promptFile: "",
          emits: ["review.done"],
        },
      ],
    });
    const iter = buildIterationContext(loop, 1);
    const role = { ...loop.topology.roles[0], concurrency: 0 };

    const result = executeDeclarativeWave(loop, iter, role, "gaps.identified");

    expect(result.reason).toBe("parallel_wave_invalid");
  });
});
