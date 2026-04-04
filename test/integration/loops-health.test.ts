import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  ensureBuild,
  makeTempProject,
  runCli,
  FIXTURES_DIR,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: loops health", () => {
  it("shows all clear when no runs exist", () => {
    const project = makeTempProject("health-empty");
    const res = runCli(["loops", "health"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout.trim()).toBe("All clear. 0 active, 0 completed in last 24h.");
  });

  it("shows all clear with completion count after successful run", () => {
    const project = makeTempProject("health-completed");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "health completed test"], { MOCK_FIXTURE_PATH: fixture });

    const res = runCli(["loops", "health"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout).toContain("All clear.");
    expect(res.stdout).toContain("completed in last 24h.");
  });

  it("shows completions with --verbose", () => {
    const project = makeTempProject("health-verbose");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "health verbose test"], { MOCK_FIXTURE_PATH: fixture });

    const res = runCli(["loops", "health", "--verbose"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    // When healthy, --verbose doesn't change the one-liner
    expect(res.stdout).toContain("All clear.");
  });

  it("shows failed run as exception", () => {
    const project = makeTempProject("health-failed");
    const registryDir = join(project, ".autoloop");
    mkdirSync(registryDir, { recursive: true });
    // Write a synthetic failed run into the registry
    const record = JSON.stringify({
      run_id: "run-test-failed-001",
      status: "failed",
      preset: "autocode",
      objective: "test failure",
      trigger: "cli",
      project_dir: project,
      work_dir: project,
      state_dir: join(project, ".autoloop"),
      journal_file: join(project, ".autoloop", "journal.jsonl"),
      parent_run_id: "",
      backend: "mock",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      iteration: 3,
      stop_reason: "backend_failed",
      latest_event: "loop.stop",
    });
    writeFileSync(join(registryDir, "registry.jsonl"), record + "\n", "utf-8");

    const res = runCli(["loops", "health"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout).toContain("FAILED:");
    expect(res.stdout).toContain("run-test-failed-001");
    expect(res.stdout).toContain("1 failed");
  });

  it("shows stuck run when updated_at is old", () => {
    const project = makeTempProject("health-stuck");
    const registryDir = join(project, ".autoloop");
    mkdirSync(registryDir, { recursive: true });
    // Write a synthetic running run with old updated_at
    const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const record = JSON.stringify({
      run_id: "run-test-stuck-001",
      status: "running",
      preset: "autocode",
      objective: "test stuck",
      trigger: "cli",
      project_dir: project,
      work_dir: project,
      state_dir: join(project, ".autoloop"),
      journal_file: join(project, ".autoloop", "journal.jsonl"),
      parent_run_id: "",
      backend: "mock",
      created_at: oldTime,
      updated_at: oldTime,
      iteration: 2,
      stop_reason: "",
      latest_event: "iteration.finish",
    });
    writeFileSync(join(registryDir, "registry.jsonl"), record + "\n", "utf-8");

    const res = runCli(["loops", "health"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout).toContain("STUCK:");
    expect(res.stdout).toContain("run-test-stuck-001");
    expect(res.stdout).toContain("1 stuck");
  });

  it("prints usage info from loops --help including health", () => {
    const project = makeTempProject("health-help");
    const res = runCli(["loops", "--help"], {}, project);
    expect(res.stdout).toContain("health");
    expect(res.stdout).toContain("watch");
  });
});
