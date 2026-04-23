import { afterEach, describe, expect, it } from "vitest";
import { color, strip } from "../src/color.js";

describe("color", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env.NO_COLOR = origEnv.NO_COLOR;
    process.env.FORCE_COLOR = origEnv.FORCE_COLOR;
    if (origEnv.NO_COLOR === undefined) delete process.env.NO_COLOR;
    if (origEnv.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR;
  });

  it("returns plain text when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    expect(color("hello", "red")).toBe("hello");
  });

  it("applies ANSI codes when FORCE_COLOR is set", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const result = color("hello", "red");
    expect(result).toContain("\x1b[31m");
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[0m");
  });

  it("returns plain text for unknown styles", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    expect(color("hello", "nonexistent")).toBe("hello");
  });

  it("combines multiple styles", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const result = color("hello", "bold", "red");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[31m");
  });
});

describe("strip", () => {
  it("removes ANSI escape codes", () => {
    expect(strip("\x1b[31mhello\x1b[0m")).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(strip("hello")).toBe("hello");
  });

  it("handles multiple escape sequences", () => {
    expect(strip("\x1b[1m\x1b[31mbold red\x1b[0m")).toBe("bold red");
  });
});
