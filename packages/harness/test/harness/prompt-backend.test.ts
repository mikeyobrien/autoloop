import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMap } from "@mobrienv/autoloop-core/agent-map";
import type { Role, Topology } from "@mobrienv/autoloop-core/topology";
import { describe, expect, it } from "vitest";
import { resolvedFromLoopBackend } from "../../src/backend/types.js";
import { buildIterationContext } from "../../src/prompt.js";
import type { LoopContext } from "../../src/types.js";

interface BackendLoopOpts {
  roles?: Role[];
  handoff?: Record<string, string[]>;
  handoffKeys?: string[];
  agentMap?: AgentMap | null;
  preset?: string;
}

function makeBackendLoop(
  name: string,
  opts: BackendLoopOpts = {},
): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-backend-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const roles: Role[] = opts.roles ?? [
    {
      id: "builder",
      prompt: "",
      promptFile: "",
      emits: ["review.ready"],
    },
  ];
  const handoff = opts.handoff ?? { "loop.start": ["builder"] };
  const handoffKeys = opts.handoffKeys ?? Object.keys(handoff);
  const topology: Topology = {
    name: "t",
    completion: "task.complete",
    roles,
    handoff,
    handoffKeys,
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
      provider: "",
      command: "claude",
      args: ["--flag", "value"],
      promptMode: "stdin",
      timeoutMs: 2000,
      trustAllTools: true,
      agent: "",
      model: "",
    },
    review: {
      enabled: false,
      every: 4,
      adversarialFirst: true,
      kind: "command",
      provider: "",
      command: "claude",
      args: [],
      promptMode: "stdin",
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
      runId: "run-b",
      selfCommand: "autoloop",
      promptOverride: null,
      backendOverride: {},
      configOverride: {},
      logLevel: "info",
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

describe("buildIterationContext backend resolution (slice 2)", () => {
  it("populates iter.backend from loop.backend with empty agent and model when no role overrides exist", () => {
    const loop = makeBackendLoop("iter");

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend).toEqual({
      kind: loop.backend.kind,
      provider: loop.backend.provider,
      command: loop.backend.command,
      args: loop.backend.args,
      promptMode: loop.backend.promptMode,
      timeoutMs: loop.backend.timeoutMs,
      trustAllTools: loop.backend.trustAllTools,
      agent: "",
      model: "",
      disallowedTools: [],
      usageFrom: "",
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
      kind: "acp",
      provider: "kiro",
      command: "kiro",
      args: ["--session", "main"],
      promptMode: "stdin",
      timeoutMs: 5000,
      trustAllTools: true,
      agent: "",
      model: "",
    };

    const resolved = resolvedFromLoopBackend(loop);

    expect(resolved).toEqual({
      kind: "acp",
      provider: "kiro",
      command: "kiro",
      args: ["--session", "main"],
      promptMode: "stdin",
      timeoutMs: 5000,
      trustAllTools: true,
      agent: "",
      model: "",
      disallowedTools: [],
      usageFrom: "",
    });
    expect(resolved.args).not.toBe(loop.backend.args);
  });
});

describe("buildIterationContext role-level override resolution (slice 3)", () => {
  it("applies role-level command, args, and model overrides while leaving untouched fields at loop defaults", () => {
    const loop = makeBackendLoop("role-override", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendCommand: "claude-builder",
          backendArgs: ["--model-preset", "builder"],
          backendModel: "opus-4-7",
        },
      ],
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend.command).toBe("claude-builder");
    expect(iter.backend.args).toEqual(["--model-preset", "builder"]);
    expect(iter.backend.model).toBe("opus-4-7");
    expect(iter.backendModel).toBe("opus-4-7");
    expect(iter.backend.kind).toBe(loop.backend.kind);
    expect(iter.backend.promptMode).toBe(loop.backend.promptMode);
    expect(iter.backend.timeoutMs).toBe(loop.backend.timeoutMs);
  });

  it("role-level ACP provider, agent, and model overrides flow into iteration backend", () => {
    const loop = makeBackendLoop("role-provider", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "acp",
          backendProvider: "claude-agent-acp",
          backendCommand: "npx",
          backendArgs: ["-y", "@agentclientprotocol/claude-agent-acp"],
          backendPromptMode: "acp",
          backendAgent: "reviewer",
          backendModel: "opus",
        },
      ],
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend).toMatchObject({
      kind: "acp",
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      promptMode: "acp",
      agent: "reviewer",
      model: "opus",
      trustAllTools: true,
    });
    expect(iter.backendAgent).toBe("reviewer");
    expect(iter.backendModel).toBe("opus");
  });

  it("agents.toml wins over role.backendAgent when resolveRoleAgent returns non-empty", () => {
    const agentMap: AgentMap = {
      globalDefault: "",
      presets: {
        autocode: {
          defaultAgent: "",
          roles: { builder: "a-agent" },
        },
      },
    };
    const loop = makeBackendLoop("agents-wins", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendAgent: "r-agent",
        },
      ],
      agentMap,
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend.agent).toBe("a-agent");
    expect(iter.backendAgent).toBe("a-agent");
  });

  it("role.backendAgent applies when agents.toml resolves to empty", () => {
    const loop = makeBackendLoop("role-agent-only", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendAgent: "r-agent",
        },
      ],
      agentMap: null,
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend.agent).toBe("r-agent");
    expect(iter.backendAgent).toBe("r-agent");
  });

  it("agents.toml applies when role has no backendAgent override", () => {
    const agentMap: AgentMap = {
      globalDefault: "",
      presets: {
        autocode: {
          defaultAgent: "",
          roles: { builder: "a-agent" },
        },
      },
    };
    const loop = makeBackendLoop("agents-only", { agentMap });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend.agent).toBe("a-agent");
    expect(iter.backendAgent).toBe("a-agent");
  });

  it("returns the global-fallback baseline when allowedRoles is empty", () => {
    const loop = makeBackendLoop("no-active", {
      roles: [],
      handoff: {},
      handoffKeys: [],
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.backend).toEqual(resolvedFromLoopBackend(loop));
    expect(iter.backend.command).toBe(loop.backend.command);
    expect(iter.backend.agent).toBe("");
    expect(iter.backend.model).toBe("");
    expect(iter.backendAgent).toBe("");
    expect(iter.backendModel).toBe("");
  });

  it("first allowed role wins when multiple roles are suggested", () => {
    const loop = makeBackendLoop("first-wins", {
      roles: [
        {
          id: "planner",
          prompt: "",
          promptFile: "",
          emits: ["tasks.ready"],
          backendCommand: "planner-cmd",
        },
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendCommand: "builder-cmd",
        },
      ],
      handoff: { "loop.start": ["planner", "builder"] },
    });

    const iter = buildIterationContext(loop, 1);

    expect(iter.allowedRoles).toEqual(["planner", "builder"]);
    expect(iter.backend.command).toBe("planner-cmd");
  });

  it("iter.backend.args is a defensive copy of role.backendArgs", () => {
    const roleArgs = ["--role-flag"];
    const loop = makeBackendLoop("role-defensive", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendArgs: roleArgs,
        },
      ],
    });

    const iter = buildIterationContext(loop, 1);
    iter.backend.args.push("--leak");

    expect(roleArgs).toEqual(["--role-flag"]);
    expect(loop.backend.args).toEqual(["--flag", "value"]);
  });
});
