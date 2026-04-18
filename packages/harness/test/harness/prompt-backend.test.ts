import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvedFromLoopBackend } from "../../src/backend/types.js";
import { buildIterationContext } from "../../src/harness/prompt.js";
import type { LoopContext } from "../../src/harness/types.js";
import type { Topology } from "../../src/topology.js";

function makeBackendLoop(name: string): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-backend-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const topology: Topology = {
    name: "t",
    completion: "task.complete",
    roles: [
      {
        id: "builder",
        prompt: "",
        promptFile: "",
        emits: ["review.ready"],
      },
    ],
    handoff: { "loop.start": ["builder"] },
    handoffKeys: ["loop.start"],
  };
  return {
    objective: "Backend resolution smoke",
    topology,
    limits: { maxIterations: 1 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: "command",
      command: "claude",
      args: ["--flag", "value"],
      promptMode: "stdin",
      timeoutMs: 2000,
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
      piAdapterPath: "/usr/bin/pi-adapter",
      baseStateDir: stateDir,
      mainProjectDir: workDir,
      worktreeBranch: "",
      worktreePath: workDir,
      worktreeMetaDir: join(stateDir, "worktree-meta"),
    },
    runtime: {
      runId: "run-b",
      selfCommand: "autoloop",
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
  };
}

describe("buildIterationContext backend resolution (slice 2)", () => {
  it("populates iter.backend from loop.backend with empty agent and model when no role overrides exist", () => {
    const loop = makeBackendLoop("iter");

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend).toEqual({
      kind: loop.backend.kind,
      command: loop.backend.command,
      args: loop.backend.args,
      promptMode: loop.backend.promptMode,
      timeoutMs: loop.backend.timeoutMs,
      agent: "",
      model: "",
    });
    expect(iter.backendModel).toBe("");
    expect(iter.backendAgent).toBe(iter.roleAgent);
  });

  it("iter.backend.args is a defensive copy, not a reference to loop.backend.args", () => {
    const loop = makeBackendLoop("copy");

    const iter = buildIterationContext(loop, 1);
    iter.backend.args.push("--leak");

    expect(loop.backend.args).toEqual(["--flag", "value"]);
  });
});

describe("resolvedFromLoopBackend", () => {
  it("round-trips a representative loop.backend and emits empty agent/model", () => {
    const loop = makeBackendLoop("round-trip");
    loop.backend = {
      kind: "kiro",
      command: "kiro",
      args: ["--session", "main"],
      promptMode: "stdin",
      timeoutMs: 5000,
    };

    const resolved = resolvedFromLoopBackend(loop);

    expect(resolved).toEqual({
      kind: "kiro",
      command: "kiro",
      args: ["--session", "main"],
      promptMode: "stdin",
      timeoutMs: 5000,
      agent: "",
      model: "",
    });
    expect(resolved.args).not.toBe(loop.backend.args);
  });
});
