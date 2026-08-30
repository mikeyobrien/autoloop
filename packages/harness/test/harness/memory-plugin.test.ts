import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryPlugin } from "@mobrienv/autoloop-core/memory-plugin";
import {
  registerMemoryPlugin,
  resetMemoryPlugins,
} from "@mobrienv/autoloop-core/memory-plugin";
import type { Role, Topology } from "@mobrienv/autoloop-core/topology";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIterationContext } from "../../src/prompt.js";
import type { LoopContext } from "../../src/types.js";

function makeLoop(workDir: string, kind: string): LoopContext {
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const roles: Role[] = [
    { id: "builder", prompt: "", promptFile: "", emits: ["review.ready"] },
  ];
  const topology: Topology = {
    name: "t",
    completion: "task.complete",
    roles,
    handoff: { "loop.start": ["builder"] },
    handoffKeys: ["loop.start"],
  };
  return {
    objective: "Memory plugin prompt",
    topology,
    limits: { maxIterations: 1 },
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
      trustAllTools: true,
      agent: "",
      model: "",
      profile: "",
      disallowedTools: [],
    },
    review: {
      enabled: false,
      every: 4,
      adversarialFirst: true,
      kind: "command",
      provider: "",
      command: "true",
      args: [],
      promptMode: "stdin",
      prompt: "",
      timeoutMs: 1000,
      trustAllTools: true,
      agent: "",
      model: "",
      profile: "",
      onError: "hold",
      minConfidence: 0.5,
    },
    parallel: {
      enabled: false,
      maxBranches: 0,
      branchTimeoutMs: 0,
      aggregate: { mode: "wait_for_all", timeoutMs: 0 },
    },
    memory: { budgetChars: 1000, kind },
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
      toolPath: "/usr/bin/autoloop",
      piAdapterPath: "/usr/bin/pi-adapter",
      baseStateDir: stateDir,
      mainProjectDir: workDir,
      worktreeBranch: "",
      worktreePath: workDir,
      worktreeMetaDir: join(stateDir, "worktree-meta"),
      configWorkDir: workDir,
    },
    runtime: {
      runId: "run-mem",
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
    agentMap: null,
    store: {},
  } as LoopContext;
}

function recordingPlugin(): MemoryPlugin & { calls: string[] } {
  const calls: string[] = [];
  const empty = { preferences: [], learnings: [], meta: [] };
  return {
    kind: "recording",
    calls,
    addLearning: () => {},
    addPreference: () => {},
    addMeta: () => {},
    addRunLearning: () => {},
    addRunMeta: () => {},
    remove: () => {},
    removeFromEither: () => {},
    promote: () => {},
    list: () => "",
    find: () => "",
    status: () => "",
    render: () => {
      calls.push("render");
      return "STUB MEMORY RENDER";
    },
    stats: () => {
      calls.push("stats");
      return {
        project: empty,
        run: empty,
        combinedRenderedChars: 0,
        budgetChars: 1000,
        truncated: false,
      };
    },
    statsProject: () => ({
      preferences: 0,
      learnings: 0,
      meta: 0,
      totalEntries: 0,
      renderedChars: 0,
      budgetChars: 1000,
      truncated: false,
    }),
    raw: () => "",
    compact: () => ({ scanned: 0, duplicatesRemoved: 0, ids: [] }),
    prune: () => ({ scanned: 0, pruned: 0, ids: [] }),
  };
}

let workDir: string;

beforeEach(() => {
  resetMemoryPlugins();
  workDir = mkdtempSync(join(tmpdir(), "autoloop-memory-plugin-harness-"));
});

afterEach(() => {
  resetMemoryPlugins();
  rmSync(workDir, { recursive: true, force: true });
});

describe("harness memory plugin", () => {
  it("renders default jsonl memory into the iteration prompt", () => {
    const loop = makeLoop(workDir, "jsonl");
    writeFileSync(
      loop.paths.memoryFile,
      '{"id": "mem-1", "type": "learning", "text": "jsonl prompt lesson", "source": "manual"}\n',
      "utf-8",
    );
    const ctx = buildIterationContext(loop, 1);
    expect(ctx.memoryText).toContain("jsonl prompt lesson");
    expect(ctx.prompt).toContain("jsonl prompt lesson");
    expect(ctx.prompt).toContain("Loop memory:");
  });

  it("invokes a registered plugin when memory.kind is set", () => {
    const stub = recordingPlugin();
    registerMemoryPlugin(stub);
    const loop = makeLoop(workDir, "recording");
    const ctx = buildIterationContext(loop, 1);
    expect(stub.calls).toEqual(["render", "stats"]);
    expect(ctx.memoryText).toBe("STUB MEMORY RENDER");
    expect(ctx.prompt).toContain("STUB MEMORY RENDER");
  });

  it("loads memory.module and injects that plugin's render", () => {
    const fixture = join(
      import.meta.dirname ?? ".",
      "../../../core/test/fixtures/external-memory-plugin.cjs",
    );
    const loop = makeLoop(workDir, "mnemosyne");
    loop.memory.module = fixture;
    const ctx = buildIterationContext(loop, 1);
    expect(ctx.memoryText).toBe("external-render");
    expect(ctx.prompt).toContain("external-render");
  });
});
