import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIssueSyncPaths } from "../src/paths.js";

function project(configText?: string, configName = "autoloops.toml"): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-sync-paths-"));
  if (configText !== undefined) {
    writeFileSync(join(dir, configName), configText);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveIssueSyncPaths", () => {
  it("uses the standalone default when runtime and project config are absent", () => {
    const dir = project();
    const paths = resolveIssueSyncPaths(dir, {});

    expect(paths).toEqual({
      stateDir: join(dir, ".autoloop"),
      configFile: join(dir, ".autoloop", "issue-sync.toml"),
      stateFile: join(dir, ".autoloop", "issue-sync-state.json"),
      tasksFile: join(dir, ".autoloop", "tasks.jsonl"),
    });
  });

  it("loads nested state and explicit task paths through real TOML config", () => {
    const dir = project(
      '[core]\nstate_dir = ".ralph/autoloop"\ntasks_file = ".queue/tasks.jsonl"\n',
    );
    const paths = resolveIssueSyncPaths(dir, {});

    expect(paths.stateDir).toBe(join(dir, ".ralph", "autoloop"));
    expect(paths.tasksFile).toBe(join(dir, ".queue", "tasks.jsonl"));
  });

  it("uses autoloops.conf with the same fallback semantics as Autoloop", () => {
    const dir = project('core.state_dir = ".legacy/state"\n', "autoloops.conf");

    expect(resolveIssueSyncPaths(dir, {}).stateDir).toBe(
      join(dir, ".legacy", "state"),
    );
  });

  it("applies project config over user config", () => {
    const dir = project('core.state_dir = ".project/state"\n');
    const userConfig = join(dir, "user.toml");
    writeFileSync(userConfig, 'core.state_dir = ".user/state"\n');
    vi.stubEnv("AUTOLOOP_CONFIG", userConfig);

    expect(resolveIssueSyncPaths(dir, {}).stateDir).toBe(
      join(dir, ".project", "state"),
    );
  });

  it("prefers base state over run state and configured state", () => {
    const dir = project('core.state_dir = ".configured"\n');
    const base = join(dir, ".shared");
    const run = join(dir, ".shared", "runs", "r1");
    const paths = resolveIssueSyncPaths(dir, {
      AUTOLOOP_BASE_STATE_DIR: base,
      AUTOLOOP_STATE_DIR: run,
    });

    expect(paths.stateDir).toBe(base);
    expect(paths.tasksFile).toBe(join(base, "tasks.jsonl"));
  });

  it("treats AUTOLOOP_STATE_DIR alone as a top-level sync override", () => {
    const dir = project('core.state_dir = ".configured"\n');
    const paths = resolveIssueSyncPaths(dir, {
      AUTOLOOP_STATE_DIR: ".runtime/sync",
    });

    expect(paths.stateDir).toBe(join(dir, ".runtime", "sync"));
    expect(paths.stateFile).toBe(
      join(dir, ".runtime", "sync", "issue-sync-state.json"),
    );
  });

  it("prefers the exact runtime task file over config and state defaults", () => {
    const dir = project('core.tasks_file = ".configured/tasks.jsonl"\n');
    const tasksFile = join(dir, "run", "tasks.jsonl");
    const paths = resolveIssueSyncPaths(dir, {
      AUTOLOOP_STATE_DIR: join(dir, "runtime"),
      AUTOLOOP_TASKS_FILE: tasksFile,
    });

    expect(paths.tasksFile).toBe(tasksFile);
  });

  it("preserves absolute configured state and task paths", () => {
    const dir = project();
    const stateDir = join(dir, "absolute-state");
    const tasksFile = join(dir, "absolute-tasks.jsonl");
    writeFileSync(
      join(dir, "autoloops.toml"),
      `[core]\nstate_dir = ${JSON.stringify(stateDir)}\ntasks_file = ${JSON.stringify(tasksFile)}\n`,
    );

    expect(resolveIssueSyncPaths(dir, {})).toMatchObject({
      stateDir,
      tasksFile,
    });
  });

  it("does not hide invalid project TOML behind default paths", () => {
    const dir = project("[core\nstate_dir = nope\n");
    expect(() => resolveIssueSyncPaths(dir, {})).toThrow();
  });
});
