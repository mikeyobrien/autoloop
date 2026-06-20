import { describe, expect, it } from "vitest";
import { defaults, getFloat, put } from "../src/config-schema.js";

describe("getFloat", () => {
  it("parses float values from config", () => {
    const cfg = put(defaults(), "event_loop.max_cost_usd", "2.5");
    expect(getFloat(cfg, "event_loop.max_cost_usd", 0)).toBe(2.5);
  });

  it("falls back on missing keys", () => {
    expect(getFloat(defaults(), "event_loop.nonexistent", 1.25)).toBe(1.25);
  });

  it("falls back on malformed values", () => {
    const cfg = put(defaults(), "event_loop.max_cost_usd", "lots");
    expect(getFloat(cfg, "event_loop.max_cost_usd", 0.5)).toBe(0.5);
  });

  it("ships disabled-by-default guard keys", () => {
    expect(getFloat(defaults(), "event_loop.max_cost_usd", -1)).toBe(0);
    expect(getFloat(defaults(), "event_loop.stall_iterations", -1)).toBe(0);
  });
});
