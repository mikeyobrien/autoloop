import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { ensureBuild, makeTempProject, runCli, inspectCli, FIXTURES_DIR } from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: inspect artifact formats", () => {
  it("renders metrics in csv and json after a successful run", () => {
    const project = makeTempProject("inspect-formats");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "integration formats"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    expect(res.status).toBe(0);

    const csv = inspectCli(["inspect", "metrics", "--format", "csv"], {}, project);
    const json = inspectCli(["inspect", "metrics", "--format", "json"], {}, project);
    expect(csv).toContain("iteration,role,event,elapsed_s,exit_code,timed_out,outcome");
    expect(json.trim().startsWith("[")).toBe(true);
  });
});
