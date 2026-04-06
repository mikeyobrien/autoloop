import { describe, expect, it } from "vitest";
import { decodeEvent } from "../../src/events/decode.js";
import { encodeEvent } from "../../src/events/encode.js";
import { isRoutingEvent, isSystemEvent } from "../../src/events/guards.js";

describe("decodeEvent edge cases", () => {
  it("returns null for empty string", () => {
    expect(decodeEvent("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(decodeEvent("   ")).toBeNull();
  });

  it("defaults run and topic to empty string when missing", () => {
    const event = decodeEvent('{"fields":{}}');
    expect(event).not.toBeNull();
    expect(event?.run).toBe("");
    expect(event?.topic).toBe("");
  });

  it("defaults run and topic when non-string", () => {
    const event = decodeEvent('{"run": 42, "topic": true, "fields":{}}');
    expect(event?.run).toBe("");
    expect(event?.topic).toBe("");
  });

  it("omits iteration when not present", () => {
    const event = decodeEvent('{"run":"r1","topic":"t","fields":{}}');
    expect(event?.iteration).toBeUndefined();
  });

  it("converts null field values to empty string", () => {
    const event = decodeEvent('{"run":"r1","topic":"t","fields":{"key":null}}');
    expect(event?.shape).toBe("fields");
    if (event?.shape === "fields") {
      expect(event?.fields.key).toBe("");
    }
  });

  it("converts numeric field values to string", () => {
    const event = decodeEvent('{"run":"r1","topic":"t","fields":{"count":42}}');
    if (event?.shape === "fields") {
      expect(event?.fields.count).toBe("42");
    }
  });

  it("treats array as non-object for fields fallback", () => {
    const event = decodeEvent('{"run":"r1","topic":"t","fields":[1,2]}');
    expect(event?.shape).toBe("fields");
    if (event?.shape === "fields") {
      expect(Object.keys(event?.fields)).toHaveLength(0);
    }
  });

  it("preserves rawFields with original types", () => {
    const event = decodeEvent(
      '{"run":"r1","topic":"t","fields":{"ok":true,"n":5}}',
    );
    if (event?.shape === "fields") {
      expect(event?.rawFields?.ok).toBe(true);
      expect(event?.rawFields?.n).toBe(5);
    }
  });

  it("decodes payload event without source", () => {
    const event = decodeEvent('{"run":"r1","topic":"t","payload":"hello"}');
    expect(event?.shape).toBe("payload");
    if (event?.shape === "payload") {
      expect(event?.payload).toBe("hello");
      expect(event?.source).toBeUndefined();
    }
  });
});

describe("encodeEvent edge cases", () => {
  it("encodes fields event with null raw field value", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "t",
      fields: { key: "" },
      rawFields: { key: null },
    });
    expect(line).toContain('"key": null');
  });

  it("encodes fields event with boolean raw field", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "t",
      fields: { done: "true" },
      rawFields: { done: true },
    });
    expect(line).toContain('"done": true');
  });

  it("encodes payload event without source", () => {
    const line = encodeEvent({
      shape: "payload",
      run: "r1",
      topic: "t",
      payload: "data",
    });
    expect(line).not.toContain("source");
  });

  it("encodes payload event without iteration", () => {
    const line = encodeEvent({
      shape: "payload",
      run: "r1",
      topic: "t",
      payload: "data",
    });
    expect(line).not.toContain("iteration");
  });

  it("uses fields when rawFields is absent", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "t",
      fields: { a: "b" },
    });
    expect(line).toContain('"a": "b"');
  });
});

describe("event guards edge cases", () => {
  it("wave.* topics are system events", () => {
    const event = decodeEvent('{"run":"r1","topic":"wave.start","fields":{}}');
    expect(isSystemEvent(event)).toBe(true);
    expect(isRoutingEvent(event)).toBe(false);
  });

  it("returns false for null on all guards", () => {
    expect(isSystemEvent(null)).toBe(false);
    expect(isRoutingEvent(null)).toBe(false);
  });

  it("empty topic is not a routing event", () => {
    const event = decodeEvent('{"run":"r1","topic":"","fields":{}}');
    expect(isRoutingEvent(event)).toBe(false);
  });

  it("custom topic is a routing event", () => {
    const event = decodeEvent(
      '{"run":"r1","topic":"gaps.identified","payload":"done"}',
    );
    expect(isRoutingEvent(event)).toBe(true);
    expect(isSystemEvent(event)).toBe(false);
  });
});
