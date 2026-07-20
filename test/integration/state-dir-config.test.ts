// Fail-closed acceptance: a project that configures `core.state_dir` must have
// ALL generic runtime + management state resolve under that root — never a
// second top-level `.autoloop/`. Exercises the real built CLI (run, loops,
// stats, verify, control) end-to-end with the mock backend, plus the default
// standalone behavior for contrast.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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

/** Read the newest run_id from the custom-root registry. */
function readRunId(project: string): string {
  const registry = join(project, CUSTOM_STATE_DIR, "registry.jsonl");
  const lines = readFileSync(registry, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
  const last = JSON.parse(lines[lines.length - 1]);
  return last.run_id as string;
}
