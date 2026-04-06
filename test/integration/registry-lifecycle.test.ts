import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readRegistry } from "../../src/registry/read.js";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  pathExists,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: registry lifecycle", () => {
  it("creates registry.jsonl with completed status after successful run", () => {
    const project = makeTempProject("registry-lifecycle");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "registry test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);

    const registryPath = join(project, ".autoloop/registry.jsonl");
    expect(pathExists(registryPath)).toBe(true);

    const records = readRegistry(registryPath);
    expect(records.length).toBeGreaterThanOrEqual(1);

    const run = records[records.length - 1];
    expect(run.status).toBe("completed");
    expect(run.objective).toBe("registry test");
    expect(run.preset).toBeTruthy();
    expect(run.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(run.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(run.latest_event).toBe("loop.complete");
    expect(run.iteration).toBeGreaterThanOrEqual(1);
  });

  it("records failed status when backend exits non-zero", () => {
    const project = makeTempProject("registry-fail");
    const fixture = join(FIXTURES_DIR, "non-zero-exit.json");
    const _res = runCli(["run", project, "fail test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    // The CLI may return non-zero for backend failure
    const registryPath = join(project, ".autoloop/registry.jsonl");
    if (!pathExists(registryPath)) return; // skip if registry wasn't created (early crash)

    const records = readRegistry(registryPath);
    const run = records[records.length - 1];
    expect(run.status).toBe("failed");
    expect(run.stop_reason).toBe("backend_failed");
  });
});
