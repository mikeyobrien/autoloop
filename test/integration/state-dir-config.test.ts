// Fail-closed acceptance: a project that configures `core.state_dir` must have
// ALL generic runtime + management state resolve under that root — never a
// second top-level `.autoloop/`. Exercises the real built CLI (run, loops,
// stats, verify, control) end-to-end with the mock backend, plus the default
// standalone behavior for contrast.

import { execSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTempProjects,
  ensureBuild,
  FIXTURES_DIR,
  MOCK_BACKEND,
  PRESET_FIXTURE_DIR,
  runCli,
} from "../helpers/runtime.js";

const CUSTOM_STATE_DIR = ".ralph/autoloop";

beforeAll(() => {
  ensureBuild();
});

afterAll(() => {
  cleanupTempProjects();
});

/**
 * Copy the minimal preset into a temp dir but rewrite its config so that:
 *  - the state root is `stateDir` (default `.ralph/autoloop`), and
 *  - journal/memory are NOT pinned explicitly (so they must DERIVE from the
 *    state root rather than staying under `.autoloop`).
 */
function makeStateDirProject(name: string, stateDir: string): string {
  const dir = mkdtempSync(join(tmpdir(), `autoloop-statedir-${name}-`));
  cpSync(PRESET_FIXTURE_DIR, dir, { recursive: true });
  const config = [
    "event_loop.max_iterations = 5",
    'event_loop.completion_event = "task.complete"',
    'event_loop.completion_promise = "LOOP_COMPLETE"',
    'backend.kind = "command"',
    'backend.command = "node"',
    `backend.args = [${JSON.stringify(MOCK_BACKEND)}]`,
    'backend.prompt_mode = "arg"',
    "backend.timeout_ms = 10000",
    "review.enabled = false",
    'harness.instructions_file = "harness.md"',
    `core.state_dir = "${stateDir}"`,
  ].join("\n");
  writeFileSync(join(dir, "autoloops.toml"), `${config}\n`, "utf-8");
  return dir;
}

function topLevelEntries(dir: string): string[] {
  return readdirSync(dir).sort();
}

describe("integration: core.state_dir is authoritative", () => {
  let project = "";

  beforeAll(() => {
    project = makeStateDirProject("run", CUSTOM_STATE_DIR);
    const res = runCli(["run", project, "state dir authority"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });
    expect(res.status).toBe(0);
  });

  it("creates operational state under the configured root only", () => {
    const stateRoot = join(project, CUSTOM_STATE_DIR);
    expect(existsSync(join(stateRoot, "registry.jsonl"))).toBe(true);
    expect(existsSync(join(stateRoot, "journal.jsonl"))).toBe(true);
    // Run-scoped per-run state also lives under the configured root.
    expect(existsSync(join(stateRoot, "runs"))).toBe(true);
  });

  it("never creates a second top-level .autoloop/ tree", () => {
    expect(existsSync(join(project, ".autoloop"))).toBe(false);
    // The only dot-dir the workflow introduces is `.ralph` (the state root).
    expect(topLevelEntries(project)).toContain(".ralph");
    expect(topLevelEntries(project)).not.toContain(".autoloop");
  });

  it("resolves registry + run listing from the custom root", () => {
    const res = runCli(["loops", "--all", "--json"], {
      AUTOLOOP_PROJECT_DIR: project,
    });
    expect(res.status).toBe(0);
    const runs = JSON.parse(res.stdout) as Array<{ run_id: string }>;
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);
  });

  it("resolves journal inspection from the custom root", () => {
    const runId = readRunId(project);
    const res = runCli(["loops", "show", runId, "--json"], {
      AUTOLOOP_PROJECT_DIR: project,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(runId);
  });

  it("resolves stats from the custom root", () => {
    const res = runCli(["stats", project, "--json"], {});
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.presets.length).toBeGreaterThan(0);
  });

  it("resolves verify from the custom root", () => {
    const res = runCli(["verify", project], {});
    // verify exits non-zero only on a failing check; the run itself must be
    // FOUND (no "No completed run" / "No run" resolution error).
    expect(res.stdout + res.stderr).not.toMatch(/No .*run/i);
  });

  it("resolves control show against the custom-root registry", () => {
    const runId = readRunId(project);
    const res = runCli(["control", "show", runId.slice(0, 8)], {
      AUTOLOOP_PROJECT_DIR: project,
    });
    expect(res.stdout + res.stderr).not.toMatch(/No run matching/i);
  });

  it("prefers AUTOLOOP_STATE_DIR for generic management commands", () => {
    const runtimeState = join(project, ".runtime", "state");
    const configuredRegistry = join(
      project,
      CUSTOM_STATE_DIR,
      "registry.jsonl",
    );
    mkdirSync(runtimeState, { recursive: true });
    const latestLine = readFileSync(configuredRegistry, "utf-8")
      .trim()
      .split("\n")
      .at(-1);
    expect(latestLine).toBeDefined();
    const latest = JSON.parse(latestLine ?? "");
    const runtimeRecord = {
      ...latest,
      run_id: "runtime-state-only",
      state_dir: runtimeState,
      updated_at: new Date().toISOString(),
    };
    writeFileSync(
      join(runtimeState, "registry.jsonl"),
      `${JSON.stringify(runtimeRecord)}\n`,
      { encoding: "utf-8", flag: "w" },
    );

    const res = runCli(["loops", "--all", "--json"], {
      AUTOLOOP_PROJECT_DIR: project,
      AUTOLOOP_STATE_DIR: runtimeState,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("runtime-state-only");
    expect(res.stdout).not.toContain(latest.run_id);
  });
});

describe("integration: custom-root isolation and overrides", () => {
  it("resumes a stopped run entirely under the custom root", () => {
    const project = makeStateDirProject("resume", CUSTOM_STATE_DIR);
    const configPath = join(project, "autoloops.toml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf-8").replace(
        "event_loop.max_iterations = 5",
        "event_loop.max_iterations = 1",
      ),
    );
    const run = runCli(["run", project, "stop then resume"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "no-completion.json"),
    });
    expect(run.status).toBe(0);
    const runId = readRunId(project);

    const resumed = runCli(["resume", runId, "--add-iterations", "1"], {
      AUTOLOOP_PROJECT_DIR: project,
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "no-completion.json"),
    });

    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain(`resumed ${runId}`);
    expect(
      readFileSync(join(project, CUSTOM_STATE_DIR, "journal.jsonl"), "utf-8"),
    ).toContain('"topic": "loop.resume"');
    expect(existsSync(join(project, ".autoloop"))).toBe(false);
  });

  it("keeps a real worktree run beneath the nested custom root", () => {
    const project = makeStateDirProject("worktree", CUSTOM_STATE_DIR);
    execSync("git init && git add . && git commit -m init", {
      cwd: project,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });

    const run = runCli(
      ["run", project, "--worktree", "--keep-worktree", "nested worktree"],
      { MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json") },
    );
    expect(run.status).toBe(0);
    const record = readLatestRecord(project);

    expect(record.isolation_mode).toBe("worktree");
    expect(record.worktree_path).toBeTruthy();
    expect(record.state_dir).toBe(join(record.worktree_path, CUSTOM_STATE_DIR));
    expect(record.journal_file).toBe(
      join(record.worktree_path, CUSTOM_STATE_DIR, "journal.jsonl"),
    );
    expect(existsSync(record.journal_file)).toBe(true);
    expect(existsSync(join(project, ".autoloop"))).toBe(false);
  });

  it("keeps explicit storage paths ahead of derived custom-root defaults", () => {
    const project = makeStateDirProject("overrides", CUSTOM_STATE_DIR);
    const configPath = join(project, "autoloops.toml");
    writeFileSync(
      configPath,
      `${readFileSync(configPath, "utf-8")}core.journal_file = ".stores/journal.jsonl"\ncore.memory_file = ".stores/memory.jsonl"\ncore.tasks_file = ".stores/tasks.jsonl"\n`,
    );

    const run = runCli(["run", project, "explicit stores"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });
    expect(run.status).toBe(0);
    const record = readLatestRecord(project);

    expect(record.journal_file).toBe(
      join(realpathSync(project), ".stores", "journal.jsonl"),
    );
    expect(existsSync(record.journal_file)).toBe(true);
    expect(existsSync(join(project, CUSTOM_STATE_DIR, "journal.jsonl"))).toBe(
      false,
    );
    expect(existsSync(join(project, ".autoloop"))).toBe(false);
  });

  it("both sync CLIs honor runtime state over configured state without network calls", () => {
    const project = makeStateDirProject("sync", CUSTOM_STATE_DIR);
    const runtimeState = join(project, ".runtime", "issue-sync");
    mkdirSync(runtimeState, { recursive: true });
    writeFileSync(
      join(runtimeState, "issue-sync.toml"),
      [
        'repo = "owner/repo"',
        'queued_label = "queued"',
        'team = "TEAM"',
        'project = "Project"',
      ].join("\n"),
    );
    const env = {
      ...process.env,
      AUTOLOOP_PROJECT_DIR: project,
      AUTOLOOP_STATE_DIR: runtimeState,
      AUTOLOOP_CONFIG: join(project, "missing-user-config.toml"),
      LINEAR_API_KEY: "local-test-key",
    };

    for (const cli of [
      join(process.cwd(), "packages", "gh-sync", "dist", "cli.js"),
      join(process.cwd(), "packages", "linear-sync", "dist", "cli.js"),
    ]) {
      const result = spawnSync(process.execPath, [cli, "local-path-check"], {
        encoding: "utf-8",
        env,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown subcommand: local-path-check");
      expect(result.stderr).not.toContain("No issue-sync.toml found");
    }
    expect(existsSync(join(project, ".autoloop"))).toBe(false);
  });
});

describe("integration: default standalone state root", () => {
  it("still uses .autoloop when core.state_dir is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "autoloop-statedir-default-"));
    cpSync(PRESET_FIXTURE_DIR, dir, { recursive: true });
    const config = [
      'backend.kind = "command"',
      'backend.command = "node"',
      `backend.args = [${JSON.stringify(MOCK_BACKEND)}]`,
      'backend.prompt_mode = "arg"',
      "backend.timeout_ms = 10000",
      "review.enabled = false",
      'harness.instructions_file = "harness.md"',
    ].join("\n");
    writeFileSync(join(dir, "autoloops.toml"), `${config}\n`, "utf-8");

    const res = runCli(["run", dir, "default state dir"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, ".autoloop", "registry.jsonl"))).toBe(true);
    expect(existsSync(join(dir, ".ralph"))).toBe(false);
  });
});

interface RegistryRecord {
  run_id: string;
  isolation_mode: string;
  worktree_path: string;
  state_dir: string;
  journal_file: string;
}

function readLatestRecord(project: string): RegistryRecord {
  const registry = join(project, CUSTOM_STATE_DIR, "registry.jsonl");
  const lines = readFileSync(registry, "utf-8")
    .split("\n")
    .filter((line) => line.trim());
  return JSON.parse(lines[lines.length - 1]) as RegistryRecord;
}

/** Read the newest run_id from the custom-root registry. */
function readRunId(project: string): string {
  return readLatestRecord(project).run_id;
}
