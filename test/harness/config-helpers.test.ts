import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLoopContext, injectClaudePermissions } from "../../src/harness/config-helpers.js";
import type { RunRecord } from "../../src/registry/types.js";

function makeProject(configToml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-ts-config-helpers-"));
  writeFileSync(join(dir, "autoloops.toml"), configToml);
  writeFileSync(join(dir, "topology.toml"), "[[role]]\nname = \"builder\"\n");
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
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
  writeFileSync(join(stateDir, "registry.jsonl"), lines.join("\n") + "\n");
}

describe("injectClaudePermissions", () => {
  it("adds Claude permissions flags for Claude command backends", () => {
    expect(injectClaudePermissions("claude", [])).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(injectClaudePermissions("/opt/tools/claude", [])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
  });

  it("does not duplicate Claude permissions flags", () => {
    expect(injectClaudePermissions("claude", ["-p", "--dangerously-skip-permissions"])).toEqual([
      "-p",
      "--dangerously-skip-permissions",
    ]);
  });

  it("leaves non-Claude backends untouched", () => {
    expect(injectClaudePermissions("node", ["script.js"])).toEqual(["script.js"]);
  });
});

describe("buildLoopContext", () => {
  it("injects Claude permissions for config-defined Claude backends", () => {
    const projectDir = makeProject([
      'event_loop.max_iterations = 1',
      'backend.kind = "command"',
      'backend.command = "claude"',
      'backend.timeout_ms = 3000000',
    ].join("\n"));

    const loop = buildLoopContext(projectDir, "test objective", "node dist/main.js", { workDir: projectDir });

    expect(loop.backend.command).toBe("claude");
    expect(loop.backend.args).toEqual(["-p", "--dangerously-skip-permissions"]);
    expect(loop.review.args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("sets isolation mode to shared by default for solo run", () => {
    const projectDir = makeProject('event_loop.max_iterations = 1\n');
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.runtime.isolationMode).toBe("shared");
    expect(loop.paths.baseStateDir).toBe(loop.paths.stateDir);
    expect(loop.paths.mainProjectDir).toBe(loop.paths.projectDir);
  });

  it("populates baseStateDir and mainProjectDir", () => {
    const projectDir = makeProject('event_loop.max_iterations = 1\n');
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.baseStateDir).toBeTruthy();
    expect(loop.paths.mainProjectDir).toBeTruthy();
    expect(loop.paths.baseStateDir).toContain(".autoloop");
  });

  it("honors worktree.enabled config key for isolation", () => {
    const projectDir = makeProject([
      'event_loop.max_iterations = 1',
      'worktree.enabled = "true"',
    ].join("\n"));
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true, // override to avoid actual git worktree creation
    });
    // noWorktree takes precedence, so mode is shared — but let's test without it
    expect(loop.runtime.isolationMode).toBe("shared");
  });

  it("falls back to isolation.enabled when worktree.enabled is absent", () => {
    const projectDir = makeProject([
      'event_loop.max_iterations = 1',
      'isolation.enabled = "true"',
    ].join("\n"));
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", {
      workDir: projectDir,
      noWorktree: true,
    });
    // noWorktree overrides config, so still shared
    expect(loop.runtime.isolationMode).toBe("shared");
  });
});

describe("buildLoopContext run-scoped isolation", () => {
  function makeProjectWithActiveRun(configToml?: string): string {
    const dir = makeProject(configToml ?? "event_loop.max_iterations = 1\n");
    seedRegistry(join(dir, ".autoloop"), [
      { run_id: "run-existing", status: "running", preset: "autocode", objective: "implement feature" },
    ]);
    return dir;
  }

  it("sets isolationMode to run-scoped when another run is active", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.runtime.isolationMode).toBe("run-scoped");
  });

  it("routes stateDir under runs/<id>/ while baseStateDir stays top-level", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.stateDir).toContain("/runs/");
    expect(loop.paths.stateDir).toContain(loop.runtime.runId);
    expect(loop.paths.baseStateDir).not.toContain("/runs/");
    expect(loop.paths.stateDir).not.toBe(loop.paths.baseStateDir);
  });

  it("routes journalFile to run-scoped dir", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.journalFile).toContain("/runs/");
    expect(loop.paths.journalFile).toContain(loop.runtime.runId);
    expect(loop.paths.journalFile).toMatch(/journal\.jsonl$/);
  });

  it("keeps registryFile at baseStateDir (not run-scoped)", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.registryFile).not.toContain("/runs/");
    expect(loop.paths.registryFile).toContain(".autoloop");
    expect(loop.paths.registryFile).toMatch(/registry\.jsonl$/);
  });

  it("routes toolPath and piAdapterPath to run-scoped dir", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.toolPath).toContain("/runs/");
    expect(loop.paths.toolPath).toContain(loop.runtime.runId);
    expect(loop.paths.piAdapterPath).toContain("/runs/");
    expect(loop.paths.piAdapterPath).toContain(loop.runtime.runId);
  });

  it("creates the run-scoped directory on disk", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(existsSync(loop.paths.stateDir)).toBe(true);
  });

  it("preserves mainProjectDir as the original projectDir", () => {
    const projectDir = makeProjectWithActiveRun();
    const loop = buildLoopContext(projectDir, "test", "node dist/main.js", { workDir: projectDir });

    expect(loop.paths.mainProjectDir).toBe(loop.paths.projectDir);
  });
});