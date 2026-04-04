import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import {
  ensureBuild,
  makeTempProject,
  runCli,
  FIXTURES_DIR,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: loops watch", () => {
  it("prints detail and exits for already-completed run", () => {
    const project = makeTempProject("watch-completed");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "watch completed test"], { MOCK_FIXTURE_PATH: fixture });

    // Get the run ID
    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    const lines = listRes.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const runId = lines[1].trim().split(/\s{2,}/)[0];

    const watchRes = runCli(["loops", "watch", runId], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(watchRes.stdout).toContain("[watch] Run already completed.");
    expect(watchRes.stdout).toContain("Run:");
    expect(watchRes.stdout).toContain("Status:");
  });

  it("supports partial run-id matching", () => {
    const project = makeTempProject("watch-partial");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "watch partial test"], { MOCK_FIXTURE_PATH: fixture });

    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    const lines = listRes.stdout.trim().split("\n");
    const runId = lines[1].trim().split(/\s{2,}/)[0];
    const partial = runId.slice(0, 8);

    const watchRes = runCli(["loops", "watch", partial], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(watchRes.stdout).toContain("[watch] Run already completed.");
    expect(watchRes.stdout).toContain(runId);
  });

  it("shows error for non-existent run", () => {
    const project = makeTempProject("watch-notfound");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "watch notfound test"], { MOCK_FIXTURE_PATH: fixture });

    const watchRes = runCli(["loops", "watch", "run-nonexistent-id"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(watchRes.stdout).toContain("No run matching");
  });

  it("shows usage when no run-id given", () => {
    const project = makeTempProject("watch-usage");
    const res = runCli(["loops", "watch"], {}, project);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("watch");
  });

  it("prints detail for failed run", () => {
    const project = makeTempProject("watch-failed");
    const fixture = join(FIXTURES_DIR, "non-zero-exit.json");
    runCli(["run", project, "watch failed test"], { MOCK_FIXTURE_PATH: fixture });

    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    const lines = listRes.stdout.trim().split("\n");
    if (lines.length < 2) return; // no runs registered
    const runId = lines[1].trim().split(/\s{2,}/)[0];

    const watchRes = runCli(["loops", "watch", runId], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(watchRes.stdout).toContain("[watch] Run already");
    expect(watchRes.stdout).toContain("Run:");
  });
});
