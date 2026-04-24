import {
  type BranchLaunch,
  branchStopReason,
  csvFieldList,
  parallelBranchBackendOverride,
  renderBranchResult,
  runtimeEnvLines,
} from "@mobrienv/autoloop-harness/parallel";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

describe("csvFieldList", () => {
  it("extracts comma-separated values from a JSON field", () => {
    const line = '{"allowed_roles": "surveyor,writer,runner"}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([
      "surveyor",
      "writer",
      "runner",
    ]);
  });

  it("returns empty array for missing field", () => {
    const line = '{"other": "value"}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([]);
  });

  it("returns empty array for empty field value", () => {
    const line = '{"allowed_roles": ""}';
    expect(csvFieldList(line, "allowed_roles")).toEqual([]);
  });

  it("handles single value without commas", () => {
    const line = '{"backend_kind": "command"}';
    expect(csvFieldList(line, "backend_kind")).toEqual(["command"]);
  });
});

describe("parallelBranchBackendOverride", () => {
  const baseLaunch: BranchLaunch = {
    branchId: "b1",
    objective: "test",
    emittedTopic: "gaps.identified",
    routingEvent: "loop.start",
    allowedRoles: [],
    allowedEvents: [],
    prompt: "do stuff",
    backendKind: "",
    backendCommand: "",
    backendArgs: [],
    backendPromptMode: "",
    logLevel: "info",
  };

  it("returns empty object when no overrides set", () => {
    expect(parallelBranchBackendOverride(baseLaunch)).toEqual({});
  });

  it("includes kind when set", () => {
    const launch = { ...baseLaunch, backendKind: "mock" };
    expect(parallelBranchBackendOverride(launch)).toEqual({ kind: "mock" });
  });

  it("includes command when set", () => {
    const launch = { ...baseLaunch, backendCommand: "claude" };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      command: "claude",
    });
  });

  it("includes args when non-empty", () => {
    const launch = { ...baseLaunch, backendArgs: ["--fast", "--model=opus"] };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      args: ["--fast", "--model=opus"],
    });
  });

  it("includes prompt_mode when set", () => {
    const launch = { ...baseLaunch, backendPromptMode: "pipe" };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      prompt_mode: "pipe",
    });
  });

  it("includes all overrides when all are set", () => {
    const launch: BranchLaunch = {
      ...baseLaunch,
      backendKind: "command",
      backendCommand: "claude",
      backendArgs: ["--fast"],
      backendPromptMode: "pipe",
    };
    expect(parallelBranchBackendOverride(launch)).toEqual({
      kind: "command",
      command: "claude",
      args: ["--fast"],
      prompt_mode: "pipe",
    });
  });
});

describe("renderBranchResult", () => {
  it("renders a branch result as markdown", () => {
    const result = {
      stop_reason: "completed",
      elapsed_ms: 1234,
      routing_event: "task.complete",
      allowed_events: ["task.complete"],
      output: "All tests pass.",
    };
    const rendered = renderBranchResult(result);
    expect(rendered).toContain("# Branch Result");
    expect(rendered).toContain("Stop reason: `completed`");
    expect(rendered).toContain("Elapsed: `1234ms`");
    expect(rendered).toContain("Routing event: `task.complete`");
    expect(rendered).toContain("## Output");
    expect(rendered).toContain("All tests pass.");
  });

  it("uses defaults for missing fields", () => {
    const rendered = renderBranchResult({});
    expect(rendered).toContain("Stop reason: `unknown`");
    expect(rendered).toContain("Elapsed: `0ms`");
    expect(rendered).toContain("Routing event: ``");
  });
});

describe("branchStopReason", () => {
  it("returns backend_timeout when stopReason is backend_timeout", () => {
    expect(branchStopReason("backend_timeout", 500, 10000)).toBe(
      "backend_timeout",
    );
  });

  it("returns backend_timeout when elapsed exceeds timeout", () => {
    expect(branchStopReason("completed", 15000, 10000)).toBe("backend_timeout");
  });

  it("returns original stop reason when within timeout", () => {
    expect(branchStopReason("completed", 5000, 10000)).toBe("completed");
  });

  it("returns original stop reason when exactly at timeout", () => {
    expect(branchStopReason("max_iterations", 10000, 10000)).toBe(
      "max_iterations",
    );
  });
});

describe("runtimeEnvLines", () => {
  const fakeLoop = {
    runtime: {
      runId: "run-abc",
      logLevel: "info",
      isolationMode: "shared",
      selfCommand: "autoloops",
    },
    completion: {
      promise: "LOOP_COMPLETE",
      event: "task.complete",
      requiredEvents: ["tests.passed"],
    },
    paths: {
      stateDir: "/tmp/state",
      projectDir: "/tmp/project",
      journalFile: "/tmp/journal.jsonl",
      memoryFile: "/tmp/memory.md",
      toolPath: "/usr/bin/autoloops",
    },
  } as unknown as LoopContext;

  it("includes all required env vars", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "3",
      "gaps.identified",
      "writer",
      "tests.written",
      "",
    );
    expect(lines).toContain("AUTOLOOP_RUN_ID='run-abc'");
    expect(lines).toContain("AUTOLOOP_ITERATION='3'");
    expect(lines).toContain("AUTOLOOP_LOG_LEVEL='info'");
    expect(lines).toContain("AUTOLOOP_COMPLETION_PROMISE='LOOP_COMPLETE'");
    expect(lines).toContain("AUTOLOOP_COMPLETION_EVENT='task.complete'");
    expect(lines).toContain("AUTOLOOP_STATE_DIR='/tmp/state'");
    expect(lines).toContain("AUTOLOOP_PROJECT_DIR='/tmp/project'");
    expect(lines).toContain("AUTOLOOP_JOURNAL_FILE='/tmp/journal.jsonl'");
    expect(lines).toContain("AUTOLOOP_EVENTS_FILE='/tmp/journal.jsonl'");
    expect(lines).toContain("AUTOLOOP_MEMORY_FILE='/tmp/memory.md'");
    expect(lines).toContain("AUTOLOOP_REQUIRED_EVENTS='tests.passed'");
    expect(lines).toContain("AUTOLOOP_RECENT_EVENT='gaps.identified'");
    expect(lines).toContain("AUTOLOOP_ALLOWED_ROLES='writer'");
    expect(lines).toContain("AUTOLOOP_ALLOWED_EVENTS='tests.written'");
    expect(lines).toContain("AUTOLOOP_BIN='/usr/bin/autoloops'");
  });

  it("omits AUTOLOOP_REVIEW_MODE when reviewMode is empty", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "1",
      "loop.start",
      "surveyor",
      "gaps.identified",
      "",
    );
    expect(lines).not.toContain("AUTOLOOP_REVIEW_MODE");
  });

  it("includes AUTOLOOP_REVIEW_MODE when reviewMode is set", () => {
    const lines = runtimeEnvLines(
      fakeLoop,
      "1",
      "loop.start",
      "review",
      "__metareview_disabled__",
      "metareview",
    );
    expect(lines).toContain("AUTOLOOP_REVIEW_MODE='metareview'");
  });
});
