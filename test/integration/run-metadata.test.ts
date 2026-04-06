import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  readText,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

describe("integration: launch metadata in loop.start journal event", () => {
  it("emits preset, trigger, created_at, project_dir, work_dir, and backend fields", () => {
    const project = makeTempProject("run-metadata");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "metadata test objective"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    const loopStartLine = journal
      .split("\n")
      .find((line) => line.includes('"topic": "loop.start"'));

    expect(loopStartLine).toBeTruthy();

    const parsed = JSON.parse(loopStartLine!) as Record<string, unknown>;
    const fields = parsed.fields as Record<string, unknown>;

    // preset is basename of the temp project dir (e.g. autoloop-run-metadata-XXXX)
    expect(typeof fields.preset).toBe("string");
    expect((fields.preset as string).length).toBeGreaterThan(0);
    expect(fields.trigger).toBe("cli");
    expect(fields.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(fields.project_dir).toBe(project);
    expect(fields.work_dir).toBeTruthy();
    expect(fields.backend).toBeTruthy();
    expect(fields.parent_run_id).toBe("");
    expect(fields.objective).toBe("metadata test objective");
  });

  it("includes max_iterations and completion fields alongside metadata", () => {
    const project = makeTempProject("run-metadata-compat");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "compat check"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    const loopStartLine = journal
      .split("\n")
      .find((line) => line.includes('"topic": "loop.start"'));

    const parsed = JSON.parse(loopStartLine!) as Record<string, unknown>;
    const fields = parsed.fields as Record<string, unknown>;

    expect(fields.max_iterations).toBe("5");
    expect(fields.completion_event).toBe("task.complete");
    expect(fields.completion_promise).toBe("LOOP_COMPLETE");
  });
});
