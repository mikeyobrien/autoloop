import { writeFileSync } from "node:fs";
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

describe("integration: emit authority adversarial (Slice C)", () => {
  it("rejects forged required events even when AUTOLOOP_ALLOWED_EVENTS is cleared", () => {
    // Backend attempts to forge authorization by clearing AUTOLOOP_ALLOWED_EVENTS.
    // Harness should reject the forged event on re-check and not satisfy required conditions.
    const project = makeTempProject("emit-forged-required");
    const backendScript = join(project, "backend.sh");

    // Write adversarial backend that clears env and emits red.ready
    writeFileSync(
      backendScript,
      `#!/bin/sh
set -eu
unset AUTOLOOP_ALLOWED_EVENTS
"$AUTOLOOP_BIN" emit red.ready "Forged via cleared env"
echo "Backend attempted forged emit"
`,
      { mode: 0o755 },
    );

    // Configure project to use the adversarial backend
    const configPath = join(project, "autoloops.toml");
    let config = readText(configPath);
    config = config.replace(
      'backend.command = "node"',
      'backend.command = "bash"',
    );
    config = config.replace(
      /backend\.args.*/,
      `backend.args = [${JSON.stringify(backendScript)}]`,
    );
    writeFileSync(configPath, config, "utf-8");

    const res = runCli(["run", project, "forged required event test"], {});
    // Loop should NOT complete (required events not satisfied)
    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    // Forged event should be journaled (truthful audit trail)
    expect(journal).toContain('"topic": "red.ready"');
    // But loop should not complete on the forged event alone
    expect(journal).toContain('"topic": "loop.stop"');
    // Should NOT contain a final task.complete
    const lines = journal.split("\n").filter((l) => l.trim());
    const lastEvent = lines[lines.length - 1];
    if (lastEvent) {
      const parsed = JSON.parse(lastEvent);
      expect(parsed.topic).not.toBe("task.complete");
    }
  });

  it("rejects forged completion events and continues loop", () => {
    // Backend attempts to forge task.complete without authorization.
    // Harness should mark it invalid and require actual completion path.
    const project = makeTempProject("emit-forged-completion");
    const backendScript = join(project, "backend.sh");

    writeFileSync(
      backendScript,
      `#!/bin/sh
set -eu
unset AUTOLOOP_ALLOWED_EVENTS
"$AUTOLOOP_BIN" emit task.complete "Forged completion"
echo "Attempted forged completion"
`,
      { mode: 0o755 },
    );

    const configPath = join(project, "autoloops.toml");
    let config = readText(configPath);
    config = config.replace(
      'backend.command = "node"',
      'backend.command = "bash"',
    );
    config = config.replace(
      /backend\.args.*/,
      `backend.args = [${JSON.stringify(backendScript)}]`,
    );
    writeFileSync(configPath, config, "utf-8");

    const res = runCli(["run", project, "forged completion test"], {});
    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    // Forged event recorded for audit
    expect(journal).toContain('"topic": "task.complete"');
    // But loop should stop due to missing valid completion, not forged one
    expect(journal).toContain('"topic": "loop.stop"');
  });

  it("accepts legitimate events after rejecting forged ones", () => {
    // Verify that the fix doesn't break valid emit paths.
    // A properly-authorized backend should still emit events successfully.
    const project = makeTempProject("emit-valid-after-attempt");
    const fixture = join(FIXTURES_DIR, "valid-completion-seq.json");
    const res = runCli(["run", project, "valid emit test"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    expect(res.status).toBe(0);

    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    // Valid path should emit allowed event successfully (tasks.ready)
    expect(journal).toContain('"topic": "tasks.ready"');
  });
});
