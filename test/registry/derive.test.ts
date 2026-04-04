import { describe, it, expect } from "vitest";
import { encodeEvent } from "../../src/events/encode.js";
import { deriveRunRecords, stopReasonToStatus } from "../../src/registry/derive.js";

function loopStartLine(runId: string, fields: Record<string, string> = {}): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    topic: "loop.start",
    fields: {
      preset: "test-preset",
      objective: "do a thing",
      trigger: "cli",
      project_dir: "/tmp/proj",
      work_dir: "/tmp/proj",
      backend: "echo",
      parent_run_id: "",
      created_at: "2026-01-01T00:00:00.000Z",
      max_iterations: "5",
      completion_event: "task.complete",
      completion_promise: "LOOP_COMPLETE",
      ...fields,
    },
  }).trim();
}

function iterationFinishLine(runId: string, iteration: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    iteration,
    topic: "iteration.finish",
    fields: { exit_code: "0", output: "done" },
  }).trim();
}

function loopCompleteLine(runId: string, iteration: string, reason: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    iteration,
    topic: "loop.complete",
    fields: { reason },
  }).trim();
}

function loopStopLine(runId: string, iteration: string, reason: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    iteration,
    topic: "loop.stop",
    fields: { reason },
  }).trim();
}

describe("deriveRunRecords", () => {
  it("creates a running record from loop.start", () => {
    const lines = [loopStartLine("run-1")];
    const records = deriveRunRecords(lines);
    expect(records).toHaveLength(1);
    expect(records[0].run_id).toBe("run-1");
    expect(records[0].status).toBe("running");
    expect(records[0].preset).toBe("test-preset");
    expect(records[0].objective).toBe("do a thing");
    expect(records[0].trigger).toBe("cli");
    expect(records[0].iteration).toBe(0);
    expect(records[0].latest_event).toBe("loop.start");
  });

  it("normalizes absolute backend paths from loop.start metadata", () => {
    const lines = [loopStartLine("run-1", { backend: "/Users/rook/.npm-global/bin/claude" })];
    const records = deriveRunRecords(lines);
    expect(records[0].backend).toBe("claude");
  });

  it("updates iteration on iteration.finish", () => {
    const lines = [
      loopStartLine("run-1"),
      iterationFinishLine("run-1", "1"),
      iterationFinishLine("run-1", "2"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].iteration).toBe(2);
    expect(records[0].status).toBe("running");
    expect(records[0].latest_event).toBe("iteration.finish");
  });

  it("marks completed on loop.complete", () => {
    const lines = [
      loopStartLine("run-1"),
      iterationFinishLine("run-1", "1"),
      loopCompleteLine("run-1", "1", "completion_event"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].status).toBe("completed");
    expect(records[0].stop_reason).toBe("completion_event");
    expect(records[0].latest_event).toBe("loop.complete");
  });

  it("maps backend_failed to failed status", () => {
    const lines = [
      loopStartLine("run-1"),
      loopStopLine("run-1", "1", "backend_failed"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].status).toBe("failed");
    expect(records[0].stop_reason).toBe("backend_failed");
  });

  it("maps backend_timeout to timed_out status", () => {
    const lines = [
      loopStartLine("run-1"),
      loopStopLine("run-1", "1", "backend_timeout"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].status).toBe("timed_out");
  });

  it("maps max_iterations to stopped status", () => {
    const lines = [
      loopStartLine("run-1"),
      loopStopLine("run-1", "", "max_iterations"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].status).toBe("stopped");
    expect(records[0].stop_reason).toBe("max_iterations");
  });

  it("handles multiple runs", () => {
    const lines = [
      loopStartLine("run-1"),
      iterationFinishLine("run-1", "1"),
      loopCompleteLine("run-1", "1", "completion_event"),
      loopStartLine("run-2", { objective: "second task" }),
      iterationFinishLine("run-2", "1"),
    ];
    const records = deriveRunRecords(lines);
    expect(records).toHaveLength(2);
    expect(records[0].run_id).toBe("run-1");
    expect(records[0].status).toBe("completed");
    expect(records[1].run_id).toBe("run-2");
    expect(records[1].status).toBe("running");
    expect(records[1].objective).toBe("second task");
  });

  it("ignores events for unknown run ids", () => {
    const lines = [
      iterationFinishLine("run-unknown", "1"),
    ];
    const records = deriveRunRecords(lines);
    expect(records).toHaveLength(0);
  });

  it("uses created_at as updated_at baseline in derivation", () => {
    const lines = [
      loopStartLine("run-1", { created_at: "2026-03-15T12:00:00.000Z" }),
      iterationFinishLine("run-1", "1"),
    ];
    const records = deriveRunRecords(lines);
    expect(records[0].updated_at).toBe("2026-03-15T12:00:00.000Z");
    expect(records[0].created_at).toBe("2026-03-15T12:00:00.000Z");
  });

  it("skips malformed lines", () => {
    const lines = [
      "not valid json",
      loopStartLine("run-1"),
      "{broken",
    ];
    const records = deriveRunRecords(lines);
    expect(records).toHaveLength(1);
    expect(records[0].run_id).toBe("run-1");
  });
});

describe("stopReasonToStatus", () => {
  it("maps backend_failed to failed", () => {
    expect(stopReasonToStatus("backend_failed")).toBe("failed");
  });

  it("maps backend_timeout to timed_out", () => {
    expect(stopReasonToStatus("backend_timeout")).toBe("timed_out");
  });

  it("maps anything else to stopped", () => {
    expect(stopReasonToStatus("max_iterations")).toBe("stopped");
    expect(stopReasonToStatus("unknown")).toBe("stopped");
  });
});
