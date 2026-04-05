import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureBuild,
  makeTempProject,
  runCli,
  inspectCli,
  pathExists,
  readText,
  FIXTURES_DIR,
  MOCK_BACKEND,
  PRESET_FIXTURE_DIR,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

function makeWorkspaceWithGlobalBackend(name: string): { workspace: string; presetDir: string } {
  const workspace = mkdtempSync(join(tmpdir(), `autoloop-global-backend-${name}-`));
  const presetDir = join(workspace, "presets", "fixture");
  cpSync(PRESET_FIXTURE_DIR, presetDir, { recursive: true });

  writeFileSync(
    join(workspace, "autoloops.toml"),
    [
      'backend.kind = "command"',
      'backend.command = "node"',
      `backend.args = [${JSON.stringify(MOCK_BACKEND)}]`,
      'backend.prompt_mode = "arg"',
      'review.enabled = false',
      'core.state_dir = ".autoloop"',
      'core.journal_file = ".autoloop/journal.jsonl"',
      'core.memory_file = ".autoloop/memory.jsonl"',
    ].join("\n") + "\n",
    "utf-8",
  );

  const presetConfigPath = join(presetDir, "autoloops.toml");
  const presetConfig = readFileSync(presetConfigPath, "utf-8")
    .replace('backend.kind = "command"', 'backend.kind = "pi"')
    .replace('backend.command = "echo"', 'backend.command = "pi"')
    .replace(/backend\.args = \[[^\n]+\]\n/, '');
  writeFileSync(presetConfigPath, presetConfig, "utf-8");

  return { workspace, presetDir };
}

describe("integration: run loop with mock backend", () => {
  it("completes successfully and creates journal + memory artifacts", () => {
    const project = makeTempProject("complete");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "integration success"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(pathExists(join(project, ".autoloop/journal.jsonl"))).toBe(true);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "loop.complete"');
    expect(journal).toContain('"reason": "completion_promise"');
  });

  it("prints concise iteration progress lines to stdout for monitoring", () => {
    const project = makeTempProject("stdout-progress");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "integration stdout progress"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const progressLine = res.stdout
      .split("\n")
      .find((line) => line.includes("[progress]"));

    expect(progressLine).toBeTruthy();
    expect(progressLine).toContain("ts=");
    expect(progressLine).toMatch(/ts=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(progressLine).toContain("iter=1");
    expect(progressLine).toContain("recent=loop.start");
    expect(progressLine).toContain("outcome=complete:completion_promise");
  });

  it("records invalid emitted events in the journal", () => {
    const project = makeTempProject("invalid-event");
    const fixture = join(FIXTURES_DIR, "invalid-event.json");
    const res = runCli(["run", project, "integration invalid event"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "event.invalid"');
    expect(journal).toContain("bogus.not.allowed");
  });

  it("prefers an accepted routing event over completion_promise within the same iteration", () => {
    const project = makeTempProject("routed-event-over-promise");
    const fixture = join(FIXTURES_DIR, "routed-event-and-promise.json");
    const res = runCli(["run", project, "integration routed event over promise"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "tasks.ready"');
    expect(journal).toContain('"iteration": "2"');
    expect(res.stdout).toContain("outcome=continue:routed_event");

    const routedIndex = journal.indexOf('"topic": "tasks.ready"');
    const secondIterationIndex = journal.indexOf('"iteration": "2"');
    const completionPromiseIndex = journal.indexOf('"topic": "loop.complete", "fields": {"reason": "completion_promise"}');

    expect(routedIndex).toBeGreaterThanOrEqual(0);
    expect(secondIterationIndex).toBeGreaterThan(routedIndex);
    if (completionPromiseIndex >= 0) {
      expect(completionPromiseIndex).toBeGreaterThan(secondIterationIndex);
    }
  });

  it("prints a progress line when stopping at max iterations", () => {
    const project = makeTempProject("max-iterations-progress");
    const fixture = join(FIXTURES_DIR, "no-completion.json");
    const res = runCli(["run", project, "integration max iterations progress"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[progress]");
    expect(res.stdout).toContain("outcome=stop:max_iterations");
  });

  it("prints a progress line when the backend fails", () => {
    const project = makeTempProject("backend-failed-progress");
    const fixture = join(FIXTURES_DIR, "non-zero-exit.json");
    const res = runCli(["run", project, "integration backend failure progress"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[progress]");
    expect(res.stdout).toContain("outcome=stop:backend_failed");
  });

  it("prints a progress line when the backend times out", () => {
    const project = makeTempProject("backend-timeout-progress");
    const configPath = join(project, "autoloops.toml");
    const config = readFileSync(configPath, "utf-8").replace(
      "backend.timeout_ms = 10000",
      "backend.timeout_ms = 50",
    );
    writeFileSync(configPath, config, "utf-8");

    const fixture = join(FIXTURES_DIR, "timeout.json");
    const res = runCli(["run", project, "integration backend timeout progress"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[progress]");
    expect(res.stdout).toContain("outcome=stop:backend_timeout");
  });

  it("stops at max iterations when no completion event is emitted", () => {
    const project = makeTempProject("max-iterations");
    const fixture = join(FIXTURES_DIR, "no-completion.json");
    const res = runCli(["run", project, "integration max iterations"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"reason": "max_iterations"');
  });

  it("uses the global backend config over preset backend config", () => {
    const { workspace, presetDir } = makeWorkspaceWithGlobalBackend("override");
    const fixture = join(FIXTURES_DIR, "complete-success.json");

    const res = runCli(["run", presetDir, "global backend override"], {
      MOCK_FIXTURE_PATH: fixture,
    }, workspace);

    expect(res.status).toBe(0);

    const journal = readText(join(workspace, ".autoloop/journal.jsonl"));
    const backendStartLine = journal
      .split("\n")
      .find((line) => line.includes('"topic": "backend.start"'));

    expect(backendStartLine).toBeTruthy();
    expect(backendStartLine).toContain('"command": "node"');
    expect(backendStartLine).not.toContain('"command": "pi"');
    expect(journal).toContain('"topic": "loop.complete"');
  });

  it("inspect commands render metrics, scratchpad, and memory", () => {
    const project = makeTempProject("inspect");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "integration inspect"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    expect(res.status).toBe(0);

    const metrics = inspectCli(["inspect", "metrics", "--format", "md"], {}, project);
    const scratchpad = inspectCli(["inspect", "scratchpad", "--format", "md"], {}, project);
    const memory = inspectCli(["inspect", "memory", "--format", "md"], {}, project);

    expect(metrics).toContain("iteration");
    expect(scratchpad).toContain("Iteration 1");
    expect(typeof memory).toBe("string");
  });
});
