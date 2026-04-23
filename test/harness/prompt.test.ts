import { encodeEvent } from "@mobrienv/autoloop-core";
import { describe, expect, it } from "vitest";
import {
  invalidEventCount,
  lastRejectedTopic,
  latestInvalidNote,
  routingEventFromLines,
} from "../../src/harness/prompt.js";

function fieldsLine(
  topic: string,
  fields: Record<string, string> = {},
  run = "r1",
  iteration = "1",
): string {
  return encodeEvent({
    shape: "fields",
    run,
    iteration,
    topic,
    fields,
    rawFields: fields,
  }).trim();
}

function payloadLine(topic: string, payload: string, run = "r1"): string {
  return encodeEvent({
    shape: "payload",
    run,
    iteration: "1",
    topic,
    payload,
    source: "agent",
  }).trim();
}

describe("routingEventFromLines", () => {
  it("defaults to loop.start with no lines", () => {
    expect(routingEventFromLines([])).toBe("loop.start");
  });

  it("returns the last routing topic", () => {
    const lines = [
      fieldsLine("loop.start"),
      payloadLine("task.complete", "done"),
    ];
    expect(routingEventFromLines(lines)).toBe("task.complete");
  });

  it("ignores non-routing topics like iteration.start", () => {
    const lines = [
      payloadLine("gaps.identified", "found stuff"),
      fieldsLine("iteration.start"),
      fieldsLine("iteration.finish", { exit_code: "0", output: "" }),
    ];
    expect(routingEventFromLines(lines)).toBe("gaps.identified");
  });

  it("extracts recent_event from event.invalid lines", () => {
    const lines = [
      payloadLine("gaps.identified", "found stuff"),
      fieldsLine("event.invalid", {
        recent_event: "gaps.identified",
        emitted: "bad.event",
        suggested_roles: "writer",
        allowed_events: "tests.written,task.complete",
      }),
    ];
    expect(routingEventFromLines(lines)).toBe("gaps.identified");
  });

  it("tracks latest routing event through multiple events", () => {
    const lines = [
      payloadLine("gaps.identified", "a"),
      payloadLine("tests.written", "b"),
      payloadLine("tests.passed", "c"),
    ];
    expect(routingEventFromLines(lines)).toBe("tests.passed");
  });
});

describe("latestInvalidNote", () => {
  it("returns empty string when no invalid events", () => {
    expect(latestInvalidNote([])).toBe("");
    expect(latestInvalidNote([payloadLine("task.complete", "done")])).toBe("");
  });

  it("returns note for invalid event", () => {
    const lines = [
      fieldsLine("event.invalid", {
        emitted: "bad.event",
        recent_event: "loop.start",
        suggested_roles: "writer",
        allowed_events: "tests.written",
      }),
    ];
    const note = latestInvalidNote(lines);
    expect(note).toContain("bad.event");
    expect(note).toContain("loop.start");
    expect(note).toContain("Re-emit using one of the allowed events above");
  });

  it("clears note when a non-system user event follows", () => {
    const lines = [
      fieldsLine("event.invalid", {
        emitted: "bad",
        recent_event: "loop.start",
        suggested_roles: "",
        allowed_events: "",
      }),
      payloadLine("task.complete", "done"),
    ];
    expect(latestInvalidNote(lines)).toBe("");
  });

  it("preserves note when only system events follow", () => {
    const lines = [
      fieldsLine("event.invalid", {
        emitted: "bad",
        recent_event: "loop.start",
        suggested_roles: "",
        allowed_events: "",
      }),
      fieldsLine("iteration.start"),
    ];
    expect(latestInvalidNote(lines)).not.toBe("");
  });
});

describe("invalidEventCount", () => {
  it("returns 0 for no lines", () => {
    expect(invalidEventCount([])).toBe(0);
  });

  it("counts event.invalid lines", () => {
    const lines = [
      fieldsLine("event.invalid", {
        emitted: "a",
        recent_event: "b",
        suggested_roles: "",
        allowed_events: "",
      }),
      payloadLine("task.complete", "done"),
      fieldsLine("event.invalid", {
        emitted: "c",
        recent_event: "d",
        suggested_roles: "",
        allowed_events: "",
      }),
    ];
    expect(invalidEventCount(lines)).toBe(2);
  });
});

describe("lastRejectedTopic", () => {
  it("returns empty string for no invalid events", () => {
    expect(lastRejectedTopic([])).toBe("");
  });

  it("returns the emitted field from the last event.invalid", () => {
    const lines = [
      fieldsLine("event.invalid", {
        emitted: "first.bad",
        recent_event: "x",
        suggested_roles: "",
        allowed_events: "",
      }),
      fieldsLine("event.invalid", {
        emitted: "second.bad",
        recent_event: "y",
        suggested_roles: "",
        allowed_events: "",
      }),
    ];
    expect(lastRejectedTopic(lines)).toBe("second.bad");
  });
});
