import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeEvent } from "@mobrienv/autoloop-core";
import { beforeEach, describe, expect, it } from "vitest";
import { readRegistry } from "../../src/registry/read.js";
import { rebuildRegistry } from "../../src/registry/rebuild.js";

function loopStartLine(runId: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    topic: "loop.start",
    fields: {
      preset: "rebuild-test",
      objective: "test rebuild",
      trigger: "cli",
      project_dir: "/tmp/proj",
      work_dir: "/tmp/proj",
      backend: "echo",
      parent_run_id: "",
      created_at: "2026-01-01T00:00:00.000Z",
      max_iterations: "3",
      completion_event: "task.complete",
      completion_promise: "LOOP_COMPLETE",
    },
  });
}

function iterationFinishLine(runId: string, iteration: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    iteration,
    topic: "iteration.finish",
    fields: { exit_code: "0", output: "ok" },
  });
}

function loopCompleteLine(runId: string, iteration: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    iteration,
    topic: "loop.complete",
    fields: { reason: "completion_event" },
  });
}

function loopStopLine(runId: string, reason: string): string {
  return encodeEvent({
    shape: "fields",
    run: runId,
    topic: "loop.stop",
    fields: { reason },
  });
}

describe("rebuildRegistry", () => {
  let journalPath: string;
  let registryPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "rebuild-test-"));
    journalPath = join(dir, "journal.jsonl");
    registryPath = join(dir, "registry.jsonl");
  });

  it("rebuilds registry from journal with completed run", () => {
    const content =
      loopStartLine("run-1") +
      iterationFinishLine("run-1", "1") +
      loopCompleteLine("run-1", "1");
    writeFileSync(journalPath, content, "utf-8");

    rebuildRegistry(journalPath, registryPath);
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
    expect(records[0].run_id).toBe("run-1");
    expect(records[0].status).toBe("completed");
    expect(records[0].iteration).toBe(1);
    expect(records[0].stop_reason).toBe("completion_event");
    expect(records[0].preset).toBe("rebuild-test");
  });

  it("rebuilds registry with multiple runs", () => {
    const content =
      loopStartLine("run-1") +
      iterationFinishLine("run-1", "1") +
      loopCompleteLine("run-1", "1") +
      loopStartLine("run-2") +
      iterationFinishLine("run-2", "1") +
      loopStopLine("run-2", "backend_failed");
    writeFileSync(journalPath, content, "utf-8");

    rebuildRegistry(journalPath, registryPath);
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe("completed");
    expect(records[1].status).toBe("failed");
  });

  it("overwrites existing registry on rebuild", () => {
    // Write an initial journal and rebuild
    writeFileSync(journalPath, loopStartLine("run-1"), "utf-8");
    rebuildRegistry(journalPath, registryPath);
    let records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("running");

    // Append completion and rebuild again
    writeFileSync(
      journalPath,
      loopStartLine("run-1") + loopCompleteLine("run-1", "1"),
      "utf-8",
    );
    rebuildRegistry(journalPath, registryPath);
    records = readRegistry(registryPath);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
  });

  it("no-ops for missing journal", () => {
    rebuildRegistry("/tmp/nonexistent-journal.jsonl", registryPath);
    const records = readRegistry(registryPath);
    expect(records).toHaveLength(0);
  });
});
