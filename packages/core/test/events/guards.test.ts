import { describe, expect, it } from "vitest";
import {
  isCoordinationEvent,
  isPayloadEvent,
  isRoutingEvent,
  isSystemEvent,
} from "../../src/events/guards.js";
import type { FieldsEvent, PayloadEvent } from "../../src/events/types.js";

function fieldsEvent(topic: string): FieldsEvent {
  return { shape: "fields", run: "r1", topic, fields: {} };
}

function payloadEvent(topic: string): PayloadEvent {
  return { shape: "payload", run: "r1", topic, payload: "data" };
}

describe("isPayloadEvent edge cases", () => {
  it("returns false for null", () => {
    expect(isPayloadEvent(null)).toBe(false);
  });

  it("returns true for payload-shaped event", () => {
    expect(isPayloadEvent(payloadEvent("custom.event"))).toBe(true);
  });

  it("returns false for fields-shaped event", () => {
    expect(isPayloadEvent(fieldsEvent("custom.event"))).toBe(false);
  });
});

describe("isSystemEvent edge cases", () => {
  it("returns false for null", () => {
    expect(isSystemEvent(null)).toBe(false);
  });

  it("returns true for wave-prefixed topics", () => {
    expect(isSystemEvent(fieldsEvent("wave.branch.start"))).toBe(true);
    expect(isSystemEvent(fieldsEvent("wave.finalize"))).toBe(true);
  });

  it("returns true for all core system topics", () => {
    const systemTopics = [
      "iteration.start",
      "iteration.finish",
      "loop.start",
      "loop.complete",
      "loop.stop",
      "review.start",
      "review.finish",
      "backend.start",
      "backend.finish",
      "event.invalid",
    ];
    for (const topic of systemTopics) {
      expect(isSystemEvent(fieldsEvent(topic))).toBe(true);
    }
  });

  it("returns false for user-defined topics", () => {
    expect(isSystemEvent(fieldsEvent("gaps.identified"))).toBe(false);
    expect(isSystemEvent(fieldsEvent("tests.passed"))).toBe(false);
  });
});

describe("isCoordinationEvent edge cases", () => {
  it("returns false for null", () => {
    expect(isCoordinationEvent(null)).toBe(false);
  });

  it("returns true for all coordination topics", () => {
    const coordTopics = [
      "issue.discovered",
      "issue.resolved",
      "slice.started",
      "slice.verified",
      "slice.committed",
      "context.archived",
      "chain.spawn",
    ];
    for (const topic of coordTopics) {
      expect(isCoordinationEvent(payloadEvent(topic))).toBe(true);
    }
  });

  it("returns false for non-coordination topics", () => {
    expect(isCoordinationEvent(fieldsEvent("loop.start"))).toBe(false);
  });
});

describe("isRoutingEvent edge cases", () => {
  it("returns false for null", () => {
    expect(isRoutingEvent(null)).toBe(false);
  });

  it("returns false for empty topic", () => {
    expect(isRoutingEvent(fieldsEvent(""))).toBe(false);
  });

  it("returns false for system events", () => {
    expect(isRoutingEvent(fieldsEvent("loop.start"))).toBe(false);
    expect(isRoutingEvent(fieldsEvent("wave.branch.start"))).toBe(false);
  });

  it("returns false for coordination events", () => {
    expect(isRoutingEvent(payloadEvent("issue.discovered"))).toBe(false);
  });

  it("returns true for user-defined events", () => {
    expect(isRoutingEvent(payloadEvent("gaps.identified"))).toBe(true);
    expect(isRoutingEvent(payloadEvent("tests.passed"))).toBe(true);
    expect(isRoutingEvent(payloadEvent("task.complete"))).toBe(true);
  });
});
