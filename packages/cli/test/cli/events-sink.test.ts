import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";
import { describe, expect, it } from "vitest";
import { ndjsonEventSink, teeEvents } from "../../src/cli/events-sink.js";

function tmpFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "autoloop-events-")), name);
}

const sampleEvents: LoopEvent[] = [
  { type: "iteration.start", iteration: 1, maxIterations: 3, runId: "r1" },
  {
    type: "progress",
    runId: "r1",
    iteration: 1,
    recentEvent: "loop.start",
    allowedRoles: ["planner"],
    emittedTopic: "tasks.ready",
    outcome: "continue:routed_event",
  },
  { type: "loop.finish", iterations: 1, stopReason: "completed", runId: "r1" },
];

describe("ndjsonEventSink", () => {
  it("writes one valid NDJSON line per event", () => {
    const path = tmpFile("events.ndjson");
    const sink = ndjsonEventSink(path);
    for (const e of sampleEvents) sink.onEvent(e);
    sink.close();

    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((e) => e.type)).toEqual([
      "iteration.start",
      "progress",
      "loop.finish",
    ]);
    // The final event carries the machine-readable run result.
    expect(parsed[2]).toMatchObject({
      type: "loop.finish",
      iterations: 1,
      stopReason: "completed",
      runId: "r1",
    });
    // The progress event (resolved routing/outcome) survives structurally.
    expect(parsed[1]).toMatchObject({
      type: "progress",
      emittedTopic: "tasks.ready",
      outcome: "continue:routed_event",
    });
  });

  it("appends rather than truncates", () => {
    const path = tmpFile("append.ndjson");
    const a = ndjsonEventSink(path);
    a.onEvent(sampleEvents[0]);
    a.close();
    const b = ndjsonEventSink(path);
    b.onEvent(sampleEvents[2]);
    b.close();

    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(2);
  });
});

describe("teeEvents", () => {
  it("invokes both emitters in order", () => {
    const calls: string[] = [];
    const tee = teeEvents(
      () => calls.push("a"),
      () => calls.push("b"),
    );
    tee(sampleEvents[0]);
    expect(calls).toEqual(["a", "b"]);
  });
});
