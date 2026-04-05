import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printBackendOutputTail } from "../../src/harness/display.js";

describe("printBackendOutputTail", () => {
  let logged: string[];
  const originalLog = console.log;

  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("prints all lines when output is shorter than maxLines", () => {
    printBackendOutputTail("line1\nline2\nline3");
    expect(logged[0]).toContain("last 3 of 3 lines");
    expect(logged[1]).toBe("line1\nline2\nline3");
  });

  it("bounds output to maxLines", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i + 1}`);
    printBackendOutputTail(lines.join("\n"), 200);
    expect(logged[0]).toContain("last 200 of 300 lines");
    expect(logged[1]).toContain("line-101");
    expect(logged[1]).toContain("line-300");
    expect(logged[1]).not.toContain("line-100\n");
  });

  it("skips printing when output is empty or whitespace", () => {
    printBackendOutputTail("");
    expect(logged.length).toBe(0);

    printBackendOutputTail("   \n  \n  ");
    expect(logged.length).toBe(0);
  });

  it("respects custom maxLines parameter", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
    printBackendOutputTail(lines.join("\n"), 5);
    expect(logged[0]).toContain("last 5 of 10 lines");
    expect(logged[1]).toContain("line-6");
    expect(logged[1]).not.toContain("line-5\n");
  });
});
