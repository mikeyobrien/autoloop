import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put } from "@mobrienv/autoloop-core/config";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import {
  buildLoopContext,
  injectClaudePermissions,
  processIntOverride,
  reloadLoop,
  resolveProcessKind,
} from "@mobrienv/autoloop-harness/config-helpers";
import { describe, expect, it } from "vitest";

function makeProject(
  configToml: string,
  options?: {
    topologyToml?: string;
    files?: Record<string, string>;
  },
): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-config-helpers-"));
  writeFileSync(join(dir, "autoloops.toml"), configToml);
  writeFileSync(
    join(dir, "topology.toml"),
    options?.topologyToml ?? '[[role]]\nname = "builder"\n',
  );
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  for (const [relativePath, content] of Object.entries(options?.files ?? {})) {
    const fullPath = join(dir, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

function seedRegistry(stateDir: string, records: Partial<RunRecord>[]): void {
  const lines = records.map((r) =>
    JSON.stringify({
      run_id: r.run_id ?? "run-other",
      status: r.status ?? "running",
      preset: r.preset ?? "autocode",
      objective: r.objective ?? "test",
      trigger: r.trigger ?? "cli",
      project_dir: r.project_dir ?? "",
      work_dir: r.work_dir ?? "",
      state_dir: r.state_dir ?? "",
      journal_file: r.journal_file ?? "",
      parent_run_id: r.parent_run_id ?? "",
      backend: r.backend ?? "node",
      backend_args: r.backend_args ?? [],
      created_at: r.created_at ?? new Date().toISOString(),
      updated_at: r.updated_at ?? new Date().toISOString(),
      iteration: r.iteration ?? 1,
      stop_reason: r.stop_reason ?? "",
      latest_event: r.latest_event ?? "loop.start",
      isolation_mode: r.isolation_mode ?? "shared",
      worktree_name: r.worktree_name ?? "",
      worktree_path: r.worktree_path ?? "",
    }),
  );
  writeFileSync(join(stateDir, "registry.jsonl"), `${lines.join("\n")}\n`);
}

describe("resolveProcessKind", () => {
  it.each([
    ["command", "claude", "command"],
    ["pi", "pi", "pi"],
    ["claude-sdk", "claude", "claude-sdk"],
    ["acp", "agent", "acp"],
    ["kiro", "kiro", "acp"],
    ["hermes", "hermes", "acp"],
  ])("resolves valid kind %s as before", (kind, command, expected) => {
    expect(resolveProcessKind(kind, command)).toBe(expected);
  });

  it.each([
    "clade-sdk",
    "Acp",
    "codex",
  ])("rejects unrecognized non-empty kind %s", (kind) => {
    expect(() => resolveProcessKind(kind, "claude")).toThrow(
      `Unrecognized backend kind ${JSON.stringify(kind)}. Valid kinds: command, pi, claude-sdk, acp, kiro, hermes. (Empty/unset means auto-detect.)`,
    );
  });

  it("rejects an unknown kind even when the command has a known heuristic", () => {
    expect(() => resolveProcessKind("clade-sdk", "pi")).toThrow(
      'Unrecognized backend kind "clade-sdk"',
    );
  });

  it("returns pi when command is pi even if kind is command", () => {
    expect(resolveProcessKind("command", "pi")).toBe("pi");
  });

  it("returns pi when command is a full path to pi", () => {
    expect(resolveProcessKind("command", "/usr/local/bin/pi")).toBe("pi");
  });

  it("keeps empty-kind auto-detection behavior", () => {
    expect(resolveProcessKind("", "pi")).toBe("pi");
    expect(resolveProcessKind("", "hermes")).toBe("acp");
    expect(resolveProcessKind("", "claude")).toBe("claude-sdk");
    expect(resolveProcessKind("", "/usr/local/bin/claude")).toBe("claude-sdk");
    expect(resolveProcessKind("", "codex")).toBe("command");
  });

  it("keeps the shell path for claude with custom args", () => {
    expect(resolveProcessKind("", "claude", { hasCustomArgs: true })).toBe(
      "command",
    );
  });
});

describe("injectClaudePermissions", () => {
  it("adds Claude permissions flags for Claude command backends", () => {
    expect(injectClaudePermissions("claude", [])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
    expect(injectClaudePermissions("/opt/tools/claude", [])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
  });

  it("does not duplicate Claude permissions flags", () => {
    expect(
      injectClaudePermissions("claude", [
        "-p",
        "--dangerously-skip-permissions",
      ]),
    ).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("leaves non-Claude backends untouched", () => {
    expect(injectClaudePermissions("node", ["script.js"])).toEqual([
      "script.js",
    ]);
  });
});

describe("buildLoopContext", () => {
  it("rejects an unrecognized global backend kind", () => {
    const projectDir = makeProject(
      ["event_loop.max_iterations = 1", 'backend.kind = "clade-sdk"'].join(
        "\n",
      ),
    );

    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      }),
    ).toThrow(
      'Unrecognized backend kind "clade-sdk". Valid kinds: command, pi, claude-sdk, acp, kiro, hermes.',
    );
  });

  it("rejects an unrecognized backend kind override", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");

    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
        backendOverride: { kind: "codex" },
      }),
    ).toThrow(
      'Unrecognized backend kind "codex". Valid kinds: command, pi, claude-sdk, acp, kiro, hermes.',
    );
  });

  it("rejects an unrecognized per-role backend kind at startup", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n", {
      topologyToml: [
        "[[role]]",
        'id = "planner"',
        'backend_kind = "claude-sdk"',
        "[[role]]",
        'id = "builder"',
        'backend_kind = "clade-sdk"',
      ].join("\n"),
    });

    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      }),
    ).toThrow(
      'Unrecognized backend kind "clade-sdk" for role "builder". Valid kinds: command, pi, claude-sdk, acp, kiro, hermes. (Empty/unset means auto-detect.)',
    );
  });

  it("auto-discovers PROMPT.md from the work directory when no prompt is provided", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-ts-prompt-work-"));
    writeFileSync(join(workDir, "PROMPT.md"), "Implement the root task\n");

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir,
    });

    expect(loop.objective).toBe("Implement the root task\n");
  });

  it("prefers an explicit prompt over work directory PROMPT.md", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-ts-prompt-work-"));
    writeFileSync(join(workDir, "PROMPT.md"), "Root prompt\n");

    const loop = buildLoopContext(
      projectDir,
      "Explicit prompt",
      "node dist/main.js",
      { workDir },
    );

    expect(loop.objective).toBe("Explicit prompt");
  });

  it("prefers configured inline prompt over work directory PROMPT.md", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'event_loop.prompt = "Configured prompt"',
      ].join("\n"),
    );
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-ts-prompt-work-"));
    writeFileSync(join(workDir, "PROMPT.md"), "Root prompt\n");

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir,
    });

    expect(loop.objective).toBe("Configured prompt");
  });

  it("prefers configured prompt_file over work directory PROMPT.md", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'event_loop.prompt_file = "task.md"',
      ].join("\n"),
      { files: { "task.md": "Configured file prompt\n" } },
    );
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-ts-prompt-work-"));
    writeFileSync(join(workDir, "PROMPT.md"), "Root prompt\n");

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir,
    });

    expect(loop.objective).toBe("Configured file prompt\n");
  });

  it("does not replace an existing in-flight plan with work directory PROMPT.md", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const workDir = mkdtempSync(join(tmpdir(), "autoloop-ts-prompt-work-"));
    const stateDir = join(workDir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "plan.md"), "Existing plan\n");
    writeFileSync(join(workDir, "PROMPT.md"), "Root prompt\n");

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir,
    });

    expect(loop.objective).toBe(
      "Do the task and publish the completion event when finished.",
    );
  });

  it("normalizes preferred ACP provider config into loop backend fields", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'backend.kind = "acp"',
        'backend.provider = "claude-agent-acp"',
        'backend.command = "npx"',
        'backend.args = ["-y", "@agentclientprotocol/claude-agent-acp"]',
        'backend.prompt_mode = "acp"',
        "backend.trust_all_tools = true",
        'backend.agent = "coder"',
        'backend.model = "sonnet"',
      ].join("\n"),
    );

    const loop = buildLoopContext(
      projectDir,
      "test objective",
      "node dist/main.js",
      {
        workDir: projectDir,
      },
    );

    expect(loop.backend).toMatchObject({
      kind: "acp",
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      promptMode: "acp",
      trustAllTools: true,
      agent: "coder",
      model: "sonnet",
    });
  });

  it("defaults completion.mustBeLast and policy.fileModAudit to false", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.completion.mustBeLast).toBe(false);
    expect(loop.policy.fileModAudit).toBe(false);
  });

  it("reads event_loop.completion_must_be_last and event_loop.audit_file_mods from TOML", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        "event_loop.completion_must_be_last = true",
        "event_loop.audit_file_mods = true",
      ].join("\n"),
    );

    const loop = buildLoopContext(projectDir, null, "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.completion.mustBeLast).toBe(true);
    expect(loop.policy.fileModAudit).toBe(true);
  });

  it("normalizes legacy kiro backend config to the ACP kiro provider", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'backend.kind = "kiro"',
        'backend.command = "kiro-cli"',
        'backend.args = ["acp"]',
        'backend.prompt_mode = "acp"',
      ].join("\n"),
    );

    const loop = buildLoopContext(
      projectDir,
      "test objective",
      "node dist/main.js",
      {
        workDir: projectDir,
      },
    );

    expect(loop.backend.kind).toBe("acp");
    expect(loop.backend.provider).toBe("kiro");
    expect(loop.backend.command).toBe("kiro-cli");
    expect(loop.backend.args).toEqual(["acp"]);
    expect(loop.backend.promptMode).toBe("acp");
  });

  it("injects Claude permissions for config-defined Claude backends", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'backend.kind = "command"',
        'backend.command = "claude"',
        "backend.timeout_ms = 3000000",
      ].join("\n"),
    );

    const loop = buildLoopContext(
      projectDir,
      "test objective",
      "node dist/main.js",
      { workDir: projectDir },
    );

    expect(loop.backend.command).toBe("claude");
    expect(loop.backend.args).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(loop.review.args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("reapplies run-scoped config overrides across hot reload", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      configOverride: put({}, "event_loop.max_iterations", "42"),
    });

    expect(loop.limits.maxIterations).toBe(42);

    writeFileSync(
      join(projectDir, "autoloops.toml"),
      "event_loop.max_iterations = 2\n",
    );
    const reloaded = reloadLoop(loop);

    expect(reloaded.limits.maxIterations).toBe(42);
  });

  it("sets isolation mode to run-scoped by default for solo run", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
    expect(loop.paths.stateDir).toContain("/runs/");
    expect(loop.paths.stateDir).toContain(loop.runtime.runId);
    expect(loop.paths.baseStateDir).not.toContain("/runs/");
    expect(loop.paths.mainProjectDir).toBe(loop.paths.projectDir);
  });

  it("populates baseStateDir and mainProjectDir", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.baseStateDir).toBeTruthy();
    expect(loop.paths.mainProjectDir).toBeTruthy();
    expect(loop.paths.baseStateDir).toContain(".autoloop");
  });

  it("honors worktree.enabled config key for isolation", () => {
    const projectDir = makeProject(
      ["event_loop.max_iterations = 1", 'worktree.enabled = "true"'].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true, // override to avoid actual git worktree creation
    });
    // noWorktree takes precedence, so mode is run-scoped (not worktree)
    expect(loop.runtime.isolationMode).toBe("run-scoped");
  });

  it("falls back to isolation.enabled when worktree.enabled is absent", () => {
    const projectDir = makeProject(
      ["event_loop.max_iterations = 1", 'isolation.enabled = "true"'].join(
        "\n",
      ),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true,
    });
    // noWorktree overrides config, so run-scoped (not worktree)
    expect(loop.runtime.isolationMode).toBe("run-scoped");
  });

  it("defaults run ids to human-readable word pairs", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.runId).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("keeps legacy compact run ids when configured", () => {
    const projectDir = makeProject(
      ["event_loop.max_iterations = 1", 'core.run_id_format = "compact"'].join(
        "\n",
      ),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.runId).toMatch(/^run-[0-9a-z]+-[0-9a-f]{4}$/);
  });
});

describe("buildLoopContext parallel.aggregate config", () => {
  it("defaults to wait_for_all with no timeout", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });
    expect(loop.parallel.aggregate).toEqual({
      mode: "wait_for_all",
      timeoutMs: 0,
    });
  });

  it("reads a configured first_success mode and timeout", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'parallel.aggregate.mode = "first_success"',
        "parallel.aggregate.timeout_ms = 45000",
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });
    expect(loop.parallel.aggregate).toEqual({
      mode: "first_success",
      timeoutMs: 45000,
    });
  });

  it("falls back to wait_for_all for an unrecognized mode", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'parallel.aggregate.mode = "bogus"',
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });
    expect(loop.parallel.aggregate.mode).toBe("wait_for_all");
  });
});

describe("buildLoopContext run-scoped isolation", () => {
  function makeProjectWithActiveRun(
    configToml?: string,
    options?: Parameters<typeof makeProject>[1],
  ): string {
    const dir = makeProject(
      configToml ?? "event_loop.max_iterations = 1\n",
      options,
    );
    seedRegistry(join(dir, ".autoloop"), [
      {
        run_id: "run-existing",
        status: "running",
        preset: "autocode",
        objective: "implement feature",
      },
    ]);
    return dir;
  }

  it("sets isolationMode to run-scoped when another run is active", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
  });

  it("routes stateDir under runs/<id>/ while baseStateDir stays top-level", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.stateDir).toContain("/runs/");
    expect(loop.paths.stateDir).toContain(loop.runtime.runId);
    expect(loop.paths.baseStateDir).not.toContain("/runs/");
    expect(loop.paths.stateDir).not.toBe(loop.paths.baseStateDir);
  });

  it("keeps journalFile global even in run-scoped mode", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.journalFile).not.toContain("/runs/");
    expect(loop.paths.journalFile).toMatch(/journal\.jsonl$/);
    expect(loop.paths.journalFile).toContain(".autoloop");
  });

  it("keeps registryFile at baseStateDir (not run-scoped)", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.registryFile).not.toContain("/runs/");
    expect(loop.paths.registryFile).toContain(".autoloop");
    expect(loop.paths.registryFile).toMatch(/registry\.jsonl$/);
  });

  it("routes toolPath and piAdapterPath to run-scoped dir", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.toolPath).toContain("/runs/");
    expect(loop.paths.toolPath).toContain(loop.runtime.runId);
    expect(loop.paths.piAdapterPath).toContain("/runs/");
    expect(loop.paths.piAdapterPath).toContain(loop.runtime.runId);
  });

  it("creates the run-scoped directory on disk", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(existsSync(loop.paths.stateDir)).toBe(true);
  });

  it("errors when harness instructions contain raw .autoloop paths", () => {
    const projectDir = makeProjectWithActiveRun(
      [
        "event_loop.max_iterations = 1",
        'harness.instructions_file = "harness.md"',
      ].join("\n"),
      {
        files: {
          "harness.md": "Shared files: .autoloop/progress.md",
        },
      },
    );
    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      }),
    ).toThrow("Raw .autoloop path found in harness instructions");
  });

  it("errors when metareview prompt contains raw .autoloop paths", () => {
    const projectDir = makeProjectWithActiveRun(
      [
        "event_loop.max_iterations = 1",
        'review.prompt_file = "metareview.md"',
      ].join("\n"),
      {
        files: {
          "metareview.md": "Inspect .autoloop/logs/ for output.",
        },
      },
    );
    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      }),
    ).toThrow("Raw .autoloop path found in metareview prompt");
  });

  it("errors when role prompt contains raw .autoloop paths", () => {
    const projectDir = makeProjectWithActiveRun(
      ["event_loop.max_iterations = 1"].join("\n"),
      {
        topologyToml: [
          "[[role]]",
          'id = "builder"',
          'prompt_file = "roles/build.md"',
          'emits = ["review.ready"]',
        ].join("\n"),
        files: {
          "roles/build.md": "Builder uses .autoloop/context.md for context.",
        },
      },
    );
    expect(() =>
      buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      }),
    ).toThrow("Raw .autoloop path found in role prompt: builder");
  });

  it("expands {{STATE_DIR}} and {{TOOL_PATH}} placeholders in harness, metareview, and role prompts", () => {
    const projectDir = makeProjectWithActiveRun(
      [
        "event_loop.max_iterations = 1",
        'harness.instructions_file = "harness.md"',
        'review.prompt_file = "metareview.md"',
      ].join("\n"),
      {
        topologyToml: [
          "[[role]]",
          'id = "builder"',
          'prompt_file = "roles/build.md"',
          'emits = ["review.ready"]',
        ].join("\n"),
        files: {
          "harness.md":
            "Shared files: {{STATE_DIR}}/progress.md\nTool: {{TOOL_PATH}}",
          "metareview.md":
            "Inspect {{STATE_DIR}}/logs/ and rerun `{{TOOL_PATH}} emit review.passed` if needed.",
          "roles/build.md":
            "Builder uses {{STATE_DIR}}/context.md and `{{TOOL_PATH}} emit review.ready`.",
        },
      },
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    // Harness instructions should have expanded placeholders
    expect(loop.harness.instructions).toContain(loop.paths.stateDir);
    expect(loop.harness.instructions).toContain(loop.paths.toolPath);
    expect(loop.harness.instructions).not.toContain("{{STATE_DIR}}");
    expect(loop.harness.instructions).not.toContain("{{TOOL_PATH}}");

    // Review/metareview prompt
    expect(loop.review.prompt).toContain(loop.paths.stateDir);
    expect(loop.review.prompt).toContain(loop.paths.toolPath);
    expect(loop.review.prompt).not.toContain("{{STATE_DIR}}");
    expect(loop.review.prompt).not.toContain("{{TOOL_PATH}}");

    // Role prompts
    expect(loop.topology.roles[0]?.prompt).toContain(loop.paths.stateDir);
    expect(loop.topology.roles[0]?.prompt).toContain(loop.paths.toolPath);
    expect(loop.topology.roles[0]?.prompt).not.toContain("{{STATE_DIR}}");
    expect(loop.topology.roles[0]?.prompt).not.toContain("{{TOOL_PATH}}");
  });

  it("preserves mainProjectDir as the original projectDir", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.mainProjectDir).toBe(loop.paths.projectDir);
  });
});

describe("default backend", () => {
  it("defaults to the claude-sdk backend when no backend is configured", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.command).toBe("claude");
    expect(loop.backend.kind).toBe("claude-sdk");
    expect(loop.backend.args).toEqual([]);
  });

  it("review backend also defaults to claude-sdk", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.review.command).toBe("claude");
    expect(loop.review.kind).toBe("claude-sdk");
  });

  it("keeps the legacy shell path when kind is pinned to command", () => {
    const projectDir = makeProject(
      'event_loop.max_iterations = 1\n\n[backend]\nkind = "command"\n',
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.kind).toBe("command");
    expect(loop.backend.args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("keeps the legacy shell path when custom args are configured", () => {
    const projectDir = makeProject(
      'event_loop.max_iterations = 1\n\n[backend]\nargs = "--model,opus"\n',
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.kind).toBe("command");
    expect(loop.backend.args).toEqual([
      "-p",
      "--model",
      "opus",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("solo-run default run-scoping", () => {
  it("solo run (no active runs) gets run-scoped isolation by default", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
  });

  it("solo run stateDir is under runs/<id>/", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.stateDir).toContain("/runs/");
    expect(loop.paths.stateDir).toContain(loop.runtime.runId);
    expect(loop.paths.baseStateDir).not.toContain("/runs/");
  });

  it("solo run journalFile stays at global .autoloop/journal.jsonl", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.journalFile).not.toContain("/runs/");
    expect(loop.paths.journalFile).toMatch(/\.autoloop\/journal\.jsonl$/);
  });

  it("solo run registryFile stays global", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.registryFile).not.toContain("/runs/");
    expect(loop.paths.registryFile).toMatch(/registry\.jsonl$/);
  });

  it("--no-worktree returns run-scoped mode for solo run", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
    expect(loop.paths.stateDir).toContain("/runs/");
  });
});

describe("global journal behavior", () => {
  it("uses events_file when the legacy alias is the only configured path", () => {
    const projectDir = makeProject(
      'event_loop.max_iterations = 1\n\n[core]\nevents_file = "x.jsonl"\n',
    );
    const originalConfig = process.env.AUTOLOOP_CONFIG;
    process.env.AUTOLOOP_CONFIG = join(projectDir, "missing-user-config.toml");

    try {
      const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
        workDir: projectDir,
      });

      expect(loop.paths.journalFile).toBe(join(projectDir, "x.jsonl"));
    } finally {
      if (originalConfig === undefined) delete process.env.AUTOLOOP_CONFIG;
      else process.env.AUTOLOOP_CONFIG = originalConfig;
    }
  });

  it("prefers journal_file when both journal path names are configured", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        "",
        "[core]",
        'journal_file = "journal.jsonl"',
        'events_file = "events.jsonl"',
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.paths.journalFile).toBe(join(projectDir, "journal.jsonl"));
  });

  it("journal path is global for solo run-scoped mode", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
    expect(loop.paths.journalFile).not.toContain("/runs/");
    expect(loop.paths.journalFile).toMatch(/journal\.jsonl$/);
  });

  it("journal path is global for concurrent run-scoped mode", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    seedRegistry(join(projectDir, ".autoloop"), [
      { run_id: "run-other", status: "running", preset: "autocode" },
    ]);
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
    expect(loop.paths.journalFile).not.toContain("/runs/");
    expect(loop.paths.journalFile).toMatch(/journal\.jsonl$/);
  });
});

describe("processIntOverride", () => {
  it("returns the override value when it is a number", () => {
    expect(
      processIntOverride({ timeout_ms: 60000 }, "timeout_ms", 300000),
    ).toBe(60000);
  });

  it("falls back when the key is absent", () => {
    expect(processIntOverride({}, "timeout_ms", 300000)).toBe(300000);
  });

  it("falls back when the value is undefined", () => {
    expect(
      processIntOverride({ timeout_ms: undefined }, "timeout_ms", 300000),
    ).toBe(300000);
  });

  it("throws when the value is a string", () => {
    expect(() =>
      processIntOverride({ timeout_ms: "60000" }, "timeout_ms", 300000),
    ).toThrow(/backend override "timeout_ms" must be an integer/);
  });

  it("throws when the value is a float", () => {
    expect(() =>
      processIntOverride({ timeout_ms: 3.14 }, "timeout_ms", 300000),
    ).toThrow(/backend override "timeout_ms" must be an integer/);
  });
});

describe("runtime budget limits", () => {
  it("max_iteration_runtime overrides backend.timeout_ms", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'event_loop.max_iteration_runtime = "12h"',
        "backend.timeout_ms = 300000",
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.timeoutMs).toBe(43_200_000);
    expect(loop.limits.maxIterationRuntimeMs).toBe(43_200_000);
  });

  it("leaves backend.timeout_ms in place when max_iteration_runtime is disabled", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        'event_loop.max_iteration_runtime = "0"',
        "backend.timeout_ms = 120000",
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.timeoutMs).toBe(120_000);
    expect(loop.limits.maxIterationRuntimeMs).toBe(0);
  });

  it("accepts bare millisecond integers", () => {
    const projectDir = makeProject(
      [
        "event_loop.max_iterations = 1",
        "event_loop.max_iteration_runtime = 900000",
      ].join("\n"),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.timeoutMs).toBe(900_000);
  });

  it("populates limits.maxRuntimeMs from a duration string", () => {
    const projectDir = makeProject(
      ["event_loop.max_iterations = 1", 'event_loop.max_runtime = "3d"'].join(
        "\n",
      ),
    );
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.limits.maxRuntimeMs).toBe(259_200_000);
  });

  it("defaults both runtime limits to disabled", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.limits.maxIterationRuntimeMs).toBe(0);
    expect(loop.limits.maxRuntimeMs).toBe(0);
  });
});

describe("buildLoopContext with backendOverride.timeout_ms", () => {
  it("applies timeout_ms from backendOverride", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      backendOverride: { timeout_ms: 60000 },
    });

    expect(loop.backend.timeoutMs).toBe(60000);
  });

  it("applies timeout_ms from step backendOverride over CLI override", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      backendOverride: { timeout_ms: 300000 },
    });

    loop.runtime.backendOverride = { timeout_ms: 60000 };
    const reloaded = reloadLoop(loop);

    expect(reloaded.backend.timeoutMs).toBe(60000);
  });
});
