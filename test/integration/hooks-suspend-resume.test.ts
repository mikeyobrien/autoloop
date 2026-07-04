import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

function appendConfig(project: string, toml: string): void {
  const configPath = join(project, "autoloops.toml");
  const existing = readFileSync(configPath, "utf-8");
  writeFileSync(configPath, `${existing}\n${toml}\n`, "utf-8");
}

function runsDirOf(project: string): string {
  return join(project, ".autoloop", "runs");
}

/** The single run-scoped id created by a fresh `run` (default isolation). */
function soleRunId(project: string): string {
  const [runId] = readdirSync(runsDirOf(project));
  return runId;
}

function stateDirOf(project: string, runId: string): string {
  return join(runsDirOf(project), runId);
}

describe("integration: hooks suspend/resume durability", () => {
  it("a suspend-policy pre_run hook writes versioned suspend-state.json and stops the run", () => {
    const project = makeTempProject("hooks-suspend-prerun");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_run"',
        'command = "exit 1"',
        'on_error = "suspend"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "test suspend"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    // A suspend is a controlled stop (like max_iterations) — the harness
    // returns a terminal RunSummary rather than throwing, so the CLI process
    // exits 0. Durability is via suspend-state.json, not the exit code.
    expect(res.status).toBe(0);

    const runId = soleRunId(project);
    const stateDir = stateDirOf(project, runId);
    const suspendPath = join(stateDir, "suspend-state.json");
    expect(existsSync(suspendPath)).toBe(true);

    const state = JSON.parse(readFileSync(suspendPath, "utf-8"));
    expect(state.schemaVersion).toBe(1);
    expect(state.phase).toBe("pre_run");
    expect(state.resumeIteration).toBe(1);
    expect(state.runId).toBe(runId);

    const journal = readFileSync(
      join(project, ".autoloop/journal.jsonl"),
      "utf-8",
    );
    expect(journal).toContain('"topic": "hook.suspend"');
    expect(journal).toContain('"reason": "suspended"');
  });

  it("hooks clear-suspend removes suspend-state.json and the resume-requested signal", () => {
    const project = makeTempProject("hooks-clear-suspend");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_run"',
        'command = "exit 1"',
        'on_error = "suspend"',
      ].join("\n"),
    );

    const runRes = runCli(["run", project, "test suspend"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });
    expect(runRes.status).toBe(0);

    const stateDir = stateDirOf(project, soleRunId(project));
    expect(existsSync(join(stateDir, "suspend-state.json"))).toBe(true);

    const res = runCli(["hooks", "clear-suspend"], {
      AUTOLOOP_STATE_DIR: stateDir,
    });

    expect(res.status).toBe(0);
    expect(existsSync(join(stateDir, "suspend-state.json"))).toBe(false);
    expect(existsSync(join(stateDir, "resume-requested"))).toBe(false);
  });

  it("`autoloop resume` loads suspend state and retries at the recorded resume point", () => {
    const project = makeTempProject("hooks-resume-cycle");
    // Fails (and suspends) on its first invocation only — a sentinel file
    // makes the retry after resume succeed, so we can observe the loop
    // actually completing on the resumed attempt.
    const sentinel = join(project, "hook-ran-once");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        `command = "test -f ${sentinel} || (touch ${sentinel} && exit 1)"`,
        'on_error = "suspend"',
      ].join("\n"),
    );

    const first = runCli(["run", project, "test suspend then resume"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });
    expect(first.status).toBe(0);

    const runId = soleRunId(project);
    const stateDir = stateDirOf(project, runId);
    const suspendPath = join(stateDir, "suspend-state.json");
    expect(existsSync(suspendPath)).toBe(true);
    const suspendState = JSON.parse(readFileSync(suspendPath, "utf-8"));
    expect(suspendState.phase).toBe("pre_iteration");
    expect(suspendState.resumeIteration).toBe(1);

    const resumeRes = runCli(
      ["resume", runId],
      { MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json") },
      project,
    );

    expect(resumeRes.status).toBe(0);
    expect(resumeRes.stdout).toContain(`resumed ${runId} from iteration 1`);

    // Resume clears durable suspend markers once it re-enters the loop.
    expect(existsSync(suspendPath)).toBe(false);
  });
});
