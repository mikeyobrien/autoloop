import { describe, expect, it } from "vitest";
import { encodeEvent } from "../../src/events/encode.js";

describe("encodeEvent edge cases", () => {
  it("encodes a fields event without iteration", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "run-1",
      topic: "loop.start",
      fields: { objective: "test coverage" },
    });
    expect(line).not.toContain('"iteration"');
    expect(line).toContain('"run": "run-1"');
    expect(line).toContain('"topic": "loop.start"');
    expect(line).toContain('"objective": "test coverage"');
  });

  it("encodes boolean raw fields as true/false", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "backend.finish",
      fields: { timed_out: "false" },
      rawFields: { timed_out: false },
    });
    expect(line).toContain('"timed_out": false');
  });

  it("encodes number raw fields without quotes", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "iteration.finish",
      fields: { exit_code: "0" },
      rawFields: { exit_code: 0 },
    });
    expect(line).toContain('"exit_code": 0');
  });

  it("encodes null raw fields as null literal", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "test",
      fields: { value: "" },
      rawFields: { value: null },
    });
    expect(line).toContain('"value": null');
  });

  it("encodes payload event without source", () => {
    const line = encodeEvent({
      shape: "payload",
      run: "r1",
      topic: "task.complete",
      payload: "done",
    });
    expect(line).not.toContain('"source"');
    expect(line).toContain('"payload": "done"');
  });

  it("encodes payload event with source", () => {
    const line = encodeEvent({
      shape: "payload",
      run: "r1",
      topic: "task.complete",
      payload: "done",
      source: "agent",
    });
    expect(line).toContain('"source": "agent"');
  });

  it("appends a newline to the encoded output", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "test",
      fields: {},
    });
    expect(line).toMatch(/\n$/);
    expect(line).not.toMatch(/\n\n$/);
  });
});
