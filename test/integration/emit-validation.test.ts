import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { ensureBuild, makeTempProject, runCli, readText, FIXTURES_DIR } from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: emit validation", () => {
  it("rejects invalid events but keeps the loop running to termination", () => {
    const project = makeTempProject("emit-validation");
    const fixture = join(FIXTURES_DIR, "invalid-event.json");
    const res = runCli(["run", project, "integration emit validation"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "event.invalid"');
    expect(journal).toContain('"topic": "loop.stop"');
  });
});
