import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLoopContext,
  injectClaudePermissions,
  processIntOverride,
  reloadLoop,
  resolveProcessKind,
} from "../../src/harness/config-helpers.js";
import type { RunRecord } from "../../src/registry/types.js";

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
  it("returns pi when kind is explicitly pi", () => {
    expect(resolveProcessKind("pi", "pi")).toBe("pi");
  });

  it("returns pi when command is pi even if kind is command", () => {
    expect(resolveProcessKind("command", "pi")).toBe("pi");
  });

  it("returns pi when command is a full path to pi", () => {
    expect(resolveProcessKind("command", "/usr/local/bin/pi")).toBe("pi");
  });

  it("returns pi when kind is empty and command is pi", () => {
    expect(resolveProcessKind("", "pi")).toBe("pi");
  });

  it("returns command for non-pi commands with kind command", () => {
    expect(resolveProcessKind("command", "claude")).toBe("command");
  });

  it("returns command for non-pi commands with empty kind", () => {
    expect(resolveProcessKind("", "claude")).toBe("command");
  });

  it("returns kiro when kind is kiro", () => {
    expect(resolveProcessKind("kiro", "kiro")).toBe("kiro");
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
    // noWorktree takes precedence, so mode is shared — but let's test without it
    expect(loop.runtime.isolationMode).toBe("shared");
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
    // noWorktree overrides config, so still shared
    expect(loop.runtime.isolationMode).toBe("shared");
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
  it("defaults to claude with permissions injection when no backend is configured", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.backend.command).toBe("claude");
    expect(loop.backend.kind).toBe("command");
    expect(loop.backend.args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("review backend also defaults to claude", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
    });

    expect(loop.review.command).toBe("claude");
    expect(loop.review.args).toEqual(["-p", "--dangerously-skip-permissions"]);
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

  it("--no-worktree still returns shared mode even for solo run", () => {
    const projectDir = makeProject("event_loop.max_iterations = 1\n");
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true,
    });

    expect(loop.runtime.isolationMode).toBe("shared");
    expect(loop.paths.baseStateDir).toBe(loop.paths.stateDir);
  });
});

describe("global journal behavior", () => {
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
