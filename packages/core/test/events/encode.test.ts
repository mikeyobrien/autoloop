import { describe, expect, it } from "vitest";
import {
  encodeEvent,
  JOURNAL_CONTRACT_VERSION,
} from "../../src/events/encode.js";

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

  it("stamps the contract version on every line (v1)", () => {
    const line = encodeEvent({
      shape: "fields",
      run: "r1",
      topic: "loop.start",
      fields: {},
    });
    const parsed = JSON.parse(line);
    expect(parsed.v).toBe(JOURNAL_CONTRACT_VERSION);
    expect(parsed.v).toBe(1);
  });

  it("stamps an injectable ISO timestamp on every line", () => {
    const fixed = "2026-06-24T12:34:56.789Z";
    const line = encodeEvent(
      { shape: "payload", run: "r1", topic: "tasks.ready", payload: "go" },
      () => fixed,
    );
    const parsed = JSON.parse(line);
    expect(parsed.ts).toBe(fixed);
    // Default source produces a parseable ISO-8601 timestamp.
    const dflt = JSON.parse(
      encodeEvent({ shape: "fields", run: "r1", topic: "x", fields: {} }),
    );
    expect(Number.isNaN(Date.parse(dflt.ts))).toBe(false);
  });

  it("remains a single valid JSON object with the documented keys", () => {
    const line = encodeEvent(
      {
        shape: "fields",
        run: "r1",
        iteration: "2",
        topic: "iteration.finish",
        fields: { exit_code: "0" },
        rawFields: { exit_code: 0 },
      },
      () => "2026-06-24T00:00:00.000Z",
    );
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      v: 1,
      ts: "2026-06-24T00:00:00.000Z",
      run: "r1",
      iteration: "2",
      topic: "iteration.finish",
      fields: { exit_code: 0 },
    });
  });
});
