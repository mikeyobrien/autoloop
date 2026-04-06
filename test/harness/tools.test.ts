import { describe, expect, it } from "vitest";
import { emitToolScript, piAdapterScript } from "../../src/harness/tools.js";
import type { LoopContext } from "../../src/harness/types.js";

function fakeLoop(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    paths: {
      projectDir: "/tmp/project",
      stateDir: "/tmp/state",
      journalFile: "/tmp/journal.jsonl",
      memoryFile: "/tmp/memory.md",
      tasksFile: "/tmp/tasks.jsonl",
      toolPath: "/usr/bin/autoloops",
      ...(overrides.paths ?? {}),
    },
    runtime: {
      runId: "run-123",
      selfCommand: "autoloops",
      ...(overrides.runtime ?? {}),
    },
    completion: {
      event: "task.complete",
      requiredEvents: ["tests.passed"],
      ...(overrides.completion ?? {}),
    },
    ...overrides,
  } as unknown as LoopContext;
}

describe("emitToolScript", () => {
  it("generates a valid shell script with shebang and set -eu", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toMatch(/^#!\/bin\/sh\n/);
    expect(script).toContain("set -eu");
  });

  it("exports AUTOLOOP_PROJECT_DIR", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_PROJECT_DIR='/tmp/project'");
  });

  it("exports AUTOLOOP_STATE_DIR", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_STATE_DIR='/tmp/state'");
  });

  it("exports AUTOLOOP_JOURNAL_FILE", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain(
      "export AUTOLOOP_JOURNAL_FILE='/tmp/journal.jsonl'",
    );
  });

  it("exports AUTOLOOP_EVENTS_FILE equal to journal file", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain(
      "export AUTOLOOP_EVENTS_FILE='/tmp/journal.jsonl'",
    );
  });

  it("exports AUTOLOOP_MEMORY_FILE", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_MEMORY_FILE='/tmp/memory.md'");
  });

  it("exports AUTOLOOP_RUN_ID", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_RUN_ID='run-123'");
  });

  it("exports AUTOLOOP_COMPLETION_EVENT", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain(
      "export AUTOLOOP_COMPLETION_EVENT='task.complete'",
    );
  });

  it("exports AUTOLOOP_REQUIRED_EVENTS", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_REQUIRED_EVENTS='tests.passed'");
  });

  it("exports AUTOLOOP_BIN", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("export AUTOLOOP_BIN='/usr/bin/autoloops'");
  });

  it("includes temp file cleanup trap", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain("trap cleanup EXIT");
  });

  it("includes emit exit code extraction", () => {
    const script = emitToolScript(fakeLoop());
    expect(script).toContain('if [ "${1:-}" = "emit" ]');
  });

  it("uses selfCommand for execution", () => {
    const loop = fakeLoop();
    (loop.runtime as any).selfCommand = "node dist/main.js";
    const script = emitToolScript(loop);
    expect(script).toContain('if node dist/main.js "$@"');
  });

  it("shell-quotes paths with special characters", () => {
    const loop = fakeLoop();
    (loop.paths as any).projectDir = "/tmp/my project's dir";
    const script = emitToolScript(loop);
    expect(script).toContain(
      "AUTOLOOP_PROJECT_DIR='/tmp/my project'\"'\"'s dir'",
    );
  });
});

describe("piAdapterScript", () => {
  it("generates a valid shell script with shebang", () => {
    const script = piAdapterScript(fakeLoop());
    expect(script).toMatch(/^#!\/bin\/sh\n/);
    expect(script).toContain("set -eu");
  });

  it("execs pi-adapter with selfCommand", () => {
    const script = piAdapterScript(fakeLoop());
    expect(script).toContain('exec autoloops pi-adapter "$@"');
  });

  it("uses custom selfCommand", () => {
    const loop = fakeLoop({
      runtime: { selfCommand: "node dist/main.js" },
    } as any);
    const script = piAdapterScript(loop);
    expect(script).toContain('exec node dist/main.js pi-adapter "$@"');
  });
});
