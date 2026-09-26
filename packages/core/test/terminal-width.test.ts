import { describe, expect, it } from "vitest";
import {
  displayWidth,
  resolveColumns,
  truncateToWidth,
} from "../src/terminal-width.js";

describe("displayWidth", () => {
  it("counts wide characters as two cells and marks as zero", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("界界")).toBe(4);
    expect(displayWidth("😀")).toBe(2);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("👩\u200d💻")).toBe(4);
    expect(displayWidth("a\u0007b")).toBe(2);
  });
});

describe("truncateToWidth", () => {
  it("leaves text that fits unchanged", () => {
    expect(truncateToWidth("hello", 5)).toBe("hello");
  });

  it("cuts by cells, never exceeding the width", () => {
    const cut = truncateToWidth(`→ bash  ${"界".repeat(30)}`, 40);
    expect(cut.endsWith("…")).toBe(true);
    expect(displayWidth(cut)).toBeLessThanOrEqual(40);
    expect(truncateToWidth("界界界", 4)).toBe("界…");
  });

  it("returns an ellipsis or nothing at tiny widths", () => {
    expect(truncateToWidth("hello", 1)).toBe("…");
    expect(truncateToWidth("hello", 0)).toBe("");
  });
});

describe("resolveColumns", () => {
  it("prefers a positive stream width", () => {
    expect(resolveColumns({ columns: 80 }, { COLUMNS: "60" }, 100)).toBe(80);
  });

  it("treats a zero-column PTY as unknown and falls back to COLUMNS", () => {
    expect(resolveColumns({ columns: 0 }, { COLUMNS: "60" }, 100)).toBe(60);
    expect(resolveColumns({}, { COLUMNS: "60" }, 100)).toBe(60);
  });

  it("falls back when neither source is usable", () => {
    expect(resolveColumns({ columns: 0 }, {}, 100)).toBe(100);
    expect(resolveColumns({}, { COLUMNS: "0" }, 100)).toBe(100);
    expect(resolveColumns({}, { COLUMNS: "wide" }, 100)).toBe(100);
  });
});
