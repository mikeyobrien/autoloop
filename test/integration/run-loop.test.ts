import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureBuild,
  makeTempProject,
  runCli,
  inspectCli,
  pathExists,
  readText,
  FIXTURES_DIR,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

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
