import { describe, expect, it } from "vitest";
import { MAX_TIMER_MS, parseDurationMs } from "../src/duration.js";

describe("parseDurationMs", () => {
  it("treats a bare integer as milliseconds", () => {
    expect(parseDurationMs("90000")).toBe(90_000);
    expect(parseDurationMs("0")).toBe(0);
  });

  it("parses every unit", () => {
    expect(parseDurationMs("500ms")).toBe(500);
    expect(parseDurationMs("45s")).toBe(45_000);
    expect(parseDurationMs("90m")).toBe(5_400_000);
    expect(parseDurationMs("12h")).toBe(43_200_000);
    expect(parseDurationMs("3d")).toBe(259_200_000);
  });

  it("parses composite durations", () => {
    expect(parseDurationMs("1h30m")).toBe(5_400_000);
    expect(parseDurationMs("1d12h")).toBe(129_600_000);
  });

  it("parses decimal durations", () => {
    expect(parseDurationMs("1.5h")).toBe(5_400_000);
    expect(parseDurationMs("0.5s")).toBe(500);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDurationMs(" 45s ")).toBe(45_000);
  });

  it("rejects invalid input", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("   ")).toBeNull();
    expect(parseDurationMs("abc")).toBeNull();
    expect(parseDurationMs("-5m")).toBeNull();
    expect(parseDurationMs("1h 30m")).toBeNull();
    expect(parseDurationMs("h")).toBeNull();
    expect(parseDurationMs("5mx")).toBeNull();
    expect(parseDurationMs("1.5")).toBeNull();
  });

  it("exports the Node timer cap", () => {
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
  });
});
