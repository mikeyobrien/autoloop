import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

function journal(project: string): string {
  return readFileSync(join(project, ".autoloop/journal.jsonl"), "utf-8");
}

/**
 * `active-prompt.md` lives under the run-scoped state dir
 * (`.autoloop/runs/<run-id>/active-prompt.md`, isolation mode default), not
 * directly under `.autoloop/` — locate it by scanning the runs directory
 * rather than hardcoding a run id.
 */
function activePrompt(project: string): string {
  const runsDir = join(project, ".autoloop", "runs");
  const runIds = readdirSync(runsDir);
  for (const runId of runIds) {
    const path = join(runsDir, runId, "active-prompt.md");
    try {
      return readFileSync(path, "utf-8");
    } catch {
      /* try the next run dir */
    }
  }
  throw new Error(`no active-prompt.md found under ${runsDir}`);
}

describe("integration: [[hook]] structured lifecycle engine", () => {
  it("[[hook]] pre_iteration/post_iteration fire in the right order alongside legacy hooks", () => {
    const project = makeTempProject("hooks-order");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "echo structured-pre"',
        "",
        "[[hook]]",
        'phase = "post_iteration"',
        'command = "echo structured-post"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "test hook order"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    expect(res.status).toBe(0);
    const j = journal(project);
    const preIdx = j.indexOf('"output": "structured-pre"');
    const postIdx = j.indexOf('"output": "structured-post"');
    const iterFinishIdx = j.indexOf('"topic": "iteration.finish"');
    expect(preIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(-1);
    // pre_iteration fires before the iteration's backend work finishes, and
    // post_iteration fires after.
    expect(preIdx).toBeLessThan(iterFinishIdx);
    expect(iterFinishIdx).toBeLessThan(postIdx);
  });

  it("on_error=block aborts the run when a pre_iteration hook fails", () => {
    const project = makeTempProject("hooks-block");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "exit 1"',
        'on_error = "block"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "test hook block"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    expect(res.status).not.toBe(0);
  });

  it("on_error=warn (default) lets the run continue past a failing hook", () => {
    const project = makeTempProject("hooks-warn");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "exit 1"',
        'on_error = "warn"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "test hook warn"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    expect(res.status).toBe(0);
  });

  it("mutate=prompt: a pre_iteration hook's stdout replaces the iteration prompt", () => {
    const project = makeTempProject("hooks-mutate-prompt");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "echo MUTATED_PROMPT_MARKER"',
        'mutate = "prompt"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "original prompt text"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    expect(res.status).toBe(0);
    const promptFile = activePrompt(project);
    expect(promptFile).toContain("MUTATED_PROMPT_MARKER");
    expect(promptFile).not.toContain("original prompt text");
  });

  it("mutate=none (default) leaves the prompt untouched even if the hook prints something", () => {
    const project = makeTempProject("hooks-no-mutate");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_iteration"',
        'command = "echo SHOULD_NOT_APPEAR_IN_PROMPT"',
      ].join("\n"),
    );

    const res = runCli(["run", project, "keep this prompt"], {
      MOCK_FIXTURE_PATH: join(FIXTURES_DIR, "complete-success.json"),
    });

    expect(res.status).toBe(0);
    const promptFile = activePrompt(project);
    expect(promptFile).toContain("keep this prompt");
    expect(promptFile).not.toContain("SHOULD_NOT_APPEAR_IN_PROMPT");
  });

  it("mutate=event: a pre_emit hook's directive changes the emitted topic", () => {
    const project = makeTempProject("hooks-mutate-event");
    appendConfig(
      project,
      [
        "[[hook]]",
        'phase = "pre_emit"',
        `command = ${JSON.stringify(
          'echo {\\"topic\\":\\"issue.discovered\\"}',
        )}`,
        'mutate = "event"',
      ].join("\n"),
    );

    const res = runCli(["emit", "some.other.topic", "hello"], {}, project);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("emitted issue.discovered");
    const j = journal(project);
    expect(j).toContain('"topic": "issue.discovered"');
  });
});
