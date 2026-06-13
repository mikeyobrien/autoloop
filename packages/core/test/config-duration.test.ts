import { describe, expect, it } from "vitest";
import { defaults, getDuration, put } from "../src/config-schema.js";
import { MAX_TIMER_MS } from "../src/duration.js";

describe("getDuration", () => {
  it("parses duration strings from config", () => {
    const cfg = put(defaults(), "event_loop.max_runtime", "12h");
    expect(getDuration(cfg, "event_loop.max_runtime", 0)).toBe(43_200_000);
  });

  it("parses bare millisecond integers", () => {
    const cfg = put(defaults(), "event_loop.max_runtime", "90000");
    expect(getDuration(cfg, "event_loop.max_runtime", 0)).toBe(90_000);
  });

  it("falls back on missing keys", () => {
    expect(getDuration(defaults(), "event_loop.nonexistent", 1234)).toBe(1234);
  });

  it("falls back on malformed values", () => {
    const cfg = put(defaults(), "event_loop.max_runtime", "forever");
    expect(getDuration(cfg, "event_loop.max_runtime", 500)).toBe(500);
  });

  it("ships disabled-by-default runtime keys", () => {
    expect(
      getDuration(defaults(), "event_loop.max_iteration_runtime", -1),
    ).toBe(0);
    expect(getDuration(defaults(), "event_loop.max_runtime", -1)).toBe(0);
  });

  it("clamps values above the Node timer cap", () => {
    const cfg = put(defaults(), "event_loop.max_runtime", "30d");
    expect(getDuration(cfg, "event_loop.max_runtime", 0)).toBe(MAX_TIMER_MS);
  });
});
