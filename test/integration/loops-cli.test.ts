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

describe("integration: loops command", () => {
  it("shows 'No active runs.' when no registry exists", () => {
    const project = makeTempProject("loops-empty");
    const res = runCli(["loops"], {}, project);
    expect(res.stdout.trim()).toBe("No active runs.");
  });

  it("shows 'No runs found.' with --all when no registry exists", () => {
    const project = makeTempProject("loops-all-empty");
    const res = runCli(["loops", "--all"], {}, project);
    expect(res.stdout.trim()).toBe("No runs found.");
  });

  it("lists completed run after successful loop", () => {
    const project = makeTempProject("loops-list");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    // Run a loop to populate the registry
    runCli(["run", project, "loops list test"], { MOCK_FIXTURE_PATH: fixture });

    // Now list all runs
    const res = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout).toContain("completed");
    expect(res.stdout).toContain("RUN ID");
  });

  it("shows no active runs after completed loop", () => {
    const project = makeTempProject("loops-active");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "active test"], { MOCK_FIXTURE_PATH: fixture });

    const res = runCli(["loops"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    // Completed runs should not appear in the active list
    expect(res.stdout.trim()).toBe("No active runs.");
  });

  it("shows run detail with loops show <run-id>", () => {
    const project = makeTempProject("loops-show");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "show detail test"], { MOCK_FIXTURE_PATH: fixture });

    // Get the run ID from --all listing
    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);

    // Extract a run ID from the output (first data line after header)
    const lines = listRes.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const runId = lines[1].trim().split(/\s{2,}/)[0];

    const showRes = runCli(["loops", "show", runId], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(showRes.stdout).toContain("Run:");
    expect(showRes.stdout).toContain("Status:");
    expect(showRes.stdout).toContain("completed");
    expect(showRes.stdout).toContain("Preset:");
    expect(showRes.stdout).toContain("Work dir:");
  });

  it("supports partial run-id matching in loops show", () => {
    const project = makeTempProject("loops-partial");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "partial match test"], { MOCK_FIXTURE_PATH: fixture });

    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    const lines = listRes.stdout.trim().split("\n");
    const runId = lines[1].trim().split(/\s{2,}/)[0];
    // Use first 8 chars as partial ID
    const partial = runId.slice(0, 8);

    const showRes = runCli(["loops", "show", partial], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(showRes.stdout).toContain("Run:");
    expect(showRes.stdout).toContain(runId);
  });

  it("shows artifact paths with loops artifacts <run-id>", () => {
    const project = makeTempProject("loops-artifacts");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "artifacts test"], { MOCK_FIXTURE_PATH: fixture });

    const listRes = runCli(["loops", "--all"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    const lines = listRes.stdout.trim().split("\n");
    const runId = lines[1].trim().split(/\s{2,}/)[0];

    const artRes = runCli(["loops", "artifacts", runId], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(artRes.stdout).toContain("Journal:");
    expect(artRes.stdout).toContain("Registry:");
    expect(artRes.stdout).toContain("State dir:");
    expect(artRes.stdout).toContain("Work dir:");
  });

  it("shows error for non-existent run ID", () => {
    const project = makeTempProject("loops-notfound");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "not found test"], { MOCK_FIXTURE_PATH: fixture });

    const res = runCli(["loops", "show", "run-nonexistent-id"], {
      MINILOOPS_PROJECT_DIR: project,
    }, project);
    expect(res.stdout).toContain("No run matching");
  });

  it("prints usage for loops --help", () => {
    const project = makeTempProject("loops-help");
    const res = runCli(["loops", "--help"], {}, project);
    expect(res.stdout).toContain("autoloops-ts loops");
    expect(res.stdout).toContain("show");
    expect(res.stdout).toContain("artifacts");
  });
});
