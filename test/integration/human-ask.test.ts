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

describe("integration: human-in-the-loop ask", () => {
  it("pauses on human.ask, journals ask.pending, and continues after the timeout", () => {
    const project = makeTempProject("human-ask");
    const fixture = join(FIXTURES_DIR, "human-ask.json");
    // No operator responds, so the ask times out quickly and the loop proceeds.
    const res = runCli(
      [
        "run",
        project,
        "needs human input",
        "--set",
        "event_loop.ask_timeout=200",
        "--set",
        "event_loop.ask_poll_ms=20",
        "--max-iterations",
        "1",
      ],
      { MOCK_FIXTURE_PATH: fixture },
    );

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));

    // The ask was detected and surfaced.
    expect(journal).toContain('"topic": "human.ask"');
    expect(journal).toContain('"topic": "ask.pending"');
    expect(journal).toContain("question_id");
    expect(journal).toContain("Which approach should I take");
    // With no response, it timed out and the loop kept going to termination.
    expect(journal).toContain('"topic": "ask.timeout"');
    expect(journal).toContain('"topic": "loop.stop"');

    // The CLI surfaced how to respond.
    expect(res.stderr).toContain("[ask] waiting for a human response");
    expect(res.stderr).toContain("autoloop control respond");
  });
});
