import { describe, expect, it } from "vitest";
import { decodeEvent } from "../../src/events/decode.js";
import { encodeEvent } from "../../src/events/encode.js";
import {
  isCoordinationEvent,
  isPayloadEvent,
  isRoutingEvent,
  isSystemEvent,
} from "../../src/events/guards.js";

describe("event codec", () => {
  it("round-trips fields events with string values", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "run-1",
      iteration: "2",
      topic: "iteration.finish",
      fields: { exit_code: "0", output: "done" },
    });
    const event = decodeEvent(line);
    expect(event).not.toBeNull();
    expect(event?.shape).toBe("fields");
    if (!event || event.shape !== "fields") return;
    expect(event.run).toBe("run-1");
    expect(event.iteration).toBe("2");
    expect(event.fields.exit_code).toBe("0");
    expect(event.fields.output).toBe("done");
  });

  it("round-trips payload events", () => {
    const line = encodeEvent({
      shape: "payload",
      run: "run-1",
      iteration: "3",
      topic: "task.complete",
      payload: "done",
      source: "agent",
    });
    const event = decodeEvent(line);
    expect(event).not.toBeNull();
    expect(event?.shape).toBe("payload");
    if (!event || event.shape !== "payload") return;
    expect(event.payload).toBe("done");
    expect(event.source).toBe("agent");
  });

  it("preserves boolean and number raw field values on decode", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "run-1",
      topic: "backend.finish",
      fields: { exit_code: "0", timed_out: "false", elapsed_s: "1" },
      rawFields: { exit_code: 0, timed_out: false, elapsed_s: 1 },
    });
    const event = decodeEvent(line);
    expect(event).not.toBeNull();
    expect(event?.shape).toBe("fields");
    if (!event || event.shape !== "fields") return;
    expect(event.fields.exit_code).toBe("0");
    expect(event.fields.timed_out).toBe("false");
    expect(event.rawFields?.timed_out).toBe(false);
    expect(event.rawFields?.elapsed_s).toBe(1);
  });

  it("returns null for invalid json", () => {
    expect(decodeEvent("not json")).toBeNull();
  });
});

describe("event guards", () => {
  const systemEvent = decodeEvent(
    '{"run":"r1","topic":"loop.start","fields":{}}',
  );
  const payloadEvent = decodeEvent(
    '{"run":"r1","topic":"task.complete","payload":"done","source":"agent"}',
  );
  const coordinationEvent = decodeEvent(
    '{"run":"r1","topic":"issue.discovered","payload":"id=1;summary=test","source":"agent"}',
  );

  it("identifies payload events", () => {
    expect(isPayloadEvent(payloadEvent)).toBe(true);
    expect(isPayloadEvent(systemEvent)).toBe(false);
  });

  it("identifies system events", () => {
    expect(isSystemEvent(systemEvent)).toBe(true);
    expect(isSystemEvent(payloadEvent)).toBe(false);
  });

  it("identifies coordination events", () => {
    expect(isCoordinationEvent(coordinationEvent)).toBe(true);
    expect(isCoordinationEvent(payloadEvent)).toBe(false);
  });

  it("identifies routing events", () => {
    expect(isRoutingEvent(payloadEvent)).toBe(true);
    expect(isRoutingEvent(systemEvent)).toBe(false);
    expect(isRoutingEvent(coordinationEvent)).toBe(false);
  });
});
