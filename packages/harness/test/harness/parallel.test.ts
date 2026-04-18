import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendBackendStart,
  type BranchLaunch,
  branchStopReason,
  buildBackendCommand,
  csvFieldList,
  parallelBranchBackendOverride,
  renderBranchResult,
  runtimeEnvLines,
} from "@mobrienv/autoloop-harness/parallel";
import { buildIterationContext } from "@mobrienv/autoloop-harness/prompt";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import type { Role } from "@mobrienv/autoloop-core/topology";

describe("csvFieldList", () => {
  it("extracts comma-separated values from a JSON field", () => {
    const line = '{"allowed_roles": "surveyor,writer,runner"}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([
      "surveyor",
      "writer",
      "runner",
    ]);
  });

  it("returns empty array for missing field", () => {
    const line = '{"other": "value"}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([]);
  });

  it("returns empty array for empty field value", () => {
    const line = '{"allowed_roles": ""}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([]);
  });

  it("handles single value without commas", () => {
    const line = '{"backend_kind": "command"}';
    expect(csvFieldList(line, "backend_kind")).toEqual(["command"]);
  });
});

describe("parallelBranchBackendOverride", () => {
  const baseLaunch: BranchLaunch = {
    branchId: "b1",
    objective: "test",
    emittedTopic: "gaps.identified",
    routingEvent: "loop.start",
    allowedRoles: [],
    allowedEvents: [],
    prompt: "do stuff",
    backendKind: "",
    backendCommand: "",
    backendArgs: [],
    backendPromptMode: "",
    logLevel: "info",
  };

  it("returns empty object when no overrides set", () => {
    expect(parallelBranchBackendOverride(baseLaunch)).toEqual({});
  });

  it("includes kind when set", () => {
    const launch = { ...baseLaunch, backendKind: "mock" };
    expect(parallelBranchBackendOverride(launch)).toEqual({ kind: "mock" });
  });

  it("includes command when set", () => {
    const launch = { ...baseLaunch, backendCommand: "claude" };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      command: "claude",
    });
  });

  it("includes args when non-empty", () => {
    const launch = { ...baseLaunch, backendArgs: ["--fast", "--model=opus"] };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      args: ["--fast", "--model=opus"],
    });
  });

  it("includes prompt_mode when set", () => {
    const launch = { ...baseLaunch, backendPromptMode: "pipe" };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      prompt_mode: "pipe",
    });
  });

  it("includes all overrides when all are set", () => {
    const launch: BranchLaunch = {
      ...baseLaunch,
      backendKind: "command",
      backendCommand: "claude",
      backendArgs: ["--fast"],
      backendPromptMode: "pipe",
    };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      kind: "command",
      command: "claude",
      args: ["--fast"],
      prompt_mode: "pipe",
    });
  });
});

describe("renderBranchResult", () => {
  it("renders a branch result as markdown", () => {
    const result = {
      stop_reason: "completed",
      elapsed_ms: 1234,
      routing_event: "task.complete",
      allowed_events: ["task.complete"],
      output: "All tests pass.",
    };
    const rendered = renderBranchResult(result);
    expect(rendered).toContain("# Branch Result");
    expect(rendered).toContain("Stop reason: `completed`");
    expect(rendered).toContain("Elapsed: `1234ms`");
    expect(rendered).toContain("Routing event: `task.complete`");
    expect(rendered).toContain("## Output");
    expect(rendered).toContain("All tests pass.");
  });

  it("uses defaults for missing fields", () => {
    const rendered = renderBranchResult({});
    expect(rendered).toContain("Stop reason: `unknown`");
    expect(rendered).toContain("Elapsed: `0ms`");
    expect(rendered).toContain("Routing event: ``");
  });
});

describe("branchStopReason", () => {
  it("returns backend_timeout when stopReason is backend_timeout", () => {
    expect(branchStopReason("backend_timeout", 500, 10000)).toBe(
      "backend_timeout",
    );
  });

  it("returns backend_timeout when elapsed exceeds timeout", () => {
    expect(branchStopReason("completed", 15000, 10000)).toBe("backend_timeout");
  });

  it("returns original stop reason when within timeout", () => {
    expect(branchStopReason("completed", 5000, 10000)).toBe("completed");
  });

  it("returns original stop reason when exactly at timeout", () => {
    expect(branchStopReason("max_iterations", 10000, 10000)).toBe(
      "max_iterations",
    );
  });
});

describe("runtimeEnvLines", () => {
  const fakeLoop = {
    runtime: {
      runId: "run-abc",
      logLevel: "info",
      isolationMode: "shared",
      selfCommand: "autoloops",
    },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: ["tests.passed"],
    },
    paths: {
      stateDir: "/tmp/state",
      projectDir: "/tmp/project",
      journalFile: "/tmp/journal.jsonl",
      memoryFile: "/tmp/memory.md",
      toolPath: "/usr/bin/autoloops",
    },
  } as unknown as LoopContext;

  it("includes all required env vars", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "3",
      "gaps.identified",
      "writer",
      "tests.written",
      "",
    );
    expect(lines).toContain("AUTOLOOP_RUN_ID='run-abc'");
    expect(lines).toContain("AUTOLOOP_ITERATION='3'");
    expect(lines).toContain("AUTOLOOP_LOG_LEVEL='info'");
    expect(lines).toContain("AUTOLOOP_COMPLETION_PROMISE='LOOP_COMPLETE'");
    expect(lines).toContain("AUTOLOOP_COMPLETION_EVENT='task.complete'");
    expect(lines).toContain("AUTOLOOP_STATE_DIR='/tmp/state'");
    expect(lines).toContain("AUTOLOOP_PROJECT_DIR='/tmp/project'");
    expect(lines).toContain("AUTOLOOP_JOURNAL_FILE='/tmp/journal.jsonl'");
    expect(lines).toContain("AUTOLOOP_EVENTS_FILE='/tmp/journal.jsonl'");
    expect(lines).toContain("AUTOLOOP_MEMORY_FILE='/tmp/memory.md'");
    expect(lines).toContain("AUTOLOOP_REQUIRED_EVENTS='tests.passed'");
    expect(lines).toContain("AUTOLOOP_RECENT_EVENT='gaps.identified'");
    expect(lines).toContain("AUTOLOOP_ALLOWED_ROLES='writer'");
    expect(lines).toContain("AUTOLOOP_ALLOWED_EVENTS='tests.written'");
    expect(lines).toContain("AUTOLOOP_BIN='/usr/bin/autoloops'");
  });

  it("omits AUTOLOOP_REVIEW_MODE when reviewMode is empty", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "1",
      "loop.start",
      "surveyor",
      "gaps.identified",
      "",
    );
    expect(lines).not.toContain("AUTOLOOP_REVIEW_MODE");
  });

  it("includes AUTOLOOP_REVIEW_MODE when reviewMode is set", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "1",
      "loop.start",
      "review",
      "__metareview_disabled__",
      "metareview",
    );
    expect(lines).toContain("AUTOLOOP_REVIEW_MODE='metareview'");
  });
});

interface BackendExecLoopOpts {
  roles?: Role[];
  handoff?: Record<string, string[]>;
  handoffKeys?: string[];
  backendKind?: string;
  backendCommand?: string;
  backendArgs?: string[];
  backendPromptMode?: string;
  backendTimeoutMs?: number;
}

function makeBackendExecLoop(
  name: string,
  opts: BackendExecLoopOpts = {},
): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), `autoloop-exec-${name}-`));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "memory.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "tasks.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  const roles: Role[] = opts.roles ?? [
    { id: "builder", prompt: "", promptFile: "", emits: ["review.ready"] },
  ];
  const handoff = opts.handoff ?? { "loop.start": ["builder"] };
  const handoffKeys = opts.handoffKeys ?? Object.keys(handoff);
  return {
    objective: "Backend execution smoke",
    topology: {
      name: "t",
      completion: "task.complete",
      roles,
      handoff,
      handoffKeys,
    },
    limits: { maxIterations: 1 },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: [],
    },
    backend: {
      kind: opts.backendKind ?? "command",
      command: opts.backendCommand ?? "claude",
      args: opts.backendArgs ?? ["--global-flag"],
      promptMode: opts.backendPromptMode ?? "stdin",
      timeoutMs: opts.backendTimeoutMs ?? 2000,
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
      piAdapterPath: "/usr/local/bin/pi-adapter",
      baseStateDir: stateDir,
      mainProjectDir: workDir,
      worktreeBranch: "",
      worktreePath: workDir,
      worktreeMetaDir: join(stateDir, "worktree-meta"),
    },
    runtime: {
      runId: "run-exec",
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

describe("buildBackendCommand honors iter.backend", () => {
  it("uses loop.backend when no role override is present", () => {
    const loop = makeBackendExecLoop("global-only");
    const iter = buildIterationContext(loop, 1);

    const command = buildBackendCommand(loop, iter);

    expect(command).toContain("claude");
    expect(command).toContain("--global-flag");
    expect(command).toContain("printf '%s'");
  });

  it("uses role.backendCommand/args/promptMode when overridden", () => {
    const loop = makeBackendExecLoop("role-override", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendCommand: "role-bin",
          backendArgs: ["--x"],
          backendPromptMode: "stdin",
        },
      ],
    });
    const iter = buildIterationContext(loop, 1);

    const command = buildBackendCommand(loop, iter);

    expect(command).toContain("role-bin");
    expect(command).toContain("--x");
    expect(command).toContain("printf '%s'");
    expect(command).not.toMatch(/(^|[^-])claude( |$)/m);
  });

  it("falls through to loop args/promptMode when only backendCommand overridden", () => {
    const loop = makeBackendExecLoop("partial-override", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendCommand: "role-only-cmd",
        },
      ],
    });
    const iter = buildIterationContext(loop, 1);

    const command = buildBackendCommand(loop, iter);

    expect(command).toContain("role-only-cmd");
    expect(command).toContain("--global-flag");
  });

  it("uses pi adapter path when iter.backend.kind === 'pi'", () => {
    const loop = makeBackendExecLoop("pi-kind", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "pi",
          backendCommand: "some-pi-subcommand",
        },
      ],
    });
    const iter = buildIterationContext(loop, 1);

    const command = buildBackendCommand(loop, iter);

    expect(command).toContain("/usr/local/bin/pi-adapter");
    expect(command).toContain("some-pi-subcommand");
  });
});

describe("appendBackendStart honors iter.backend", () => {
  it("writes loop.backend.* fields when no role override is present", () => {
    const loop = makeBackendExecLoop("append-global");
    const iter = buildIterationContext(loop, 1);

    appendBackendStart(loop, iter);

    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    const lines = journal.trim().split("\n");
    const startLine = lines.find((l) => l.includes('"backend.start"'));
    expect(startLine).toBeDefined();
    expect(startLine).toContain('"backend_kind": "command"');
    expect(startLine).toContain('"command": "claude"');
    expect(startLine).toContain('"prompt_mode": "stdin"');
    expect(startLine).toContain('"timeout_ms": "2000"');
  });

  it("writes iter.backend.* fields when role overrides kind/command/promptMode/timeoutMs", () => {
    const loop = makeBackendExecLoop("append-role", {
      roles: [
        {
          id: "builder",
          prompt: "",
          promptFile: "",
          emits: ["review.ready"],
          backendKind: "pi",
          backendCommand: "pi-runner",
          backendPromptMode: "arg",
          backendTimeoutMs: 9999,
        },
      ],
    });
    const iter = buildIterationContext(loop, 1);

    appendBackendStart(loop, iter);

    const journal = readFileSync(loop.paths.journalFile, "utf-8");
    const lines = journal.trim().split("\n");
    const startLine = lines.find((l) => l.includes('"backend.start"'));
    expect(startLine).toBeDefined();
    expect(startLine).toContain('"backend_kind": "pi"');
    expect(startLine).toContain('"command": "pi-runner"');
    expect(startLine).toContain('"prompt_mode": "arg"');
    expect(startLine).toContain('"timeout_ms": "9999"');
    expect(startLine).not.toContain('"backend_kind": "command"');
    expect(startLine).not.toContain('"timeout_ms": "2000"');
  });
});
