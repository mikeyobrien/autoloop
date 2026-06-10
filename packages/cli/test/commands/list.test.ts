import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dispatchList } from "../../src/commands/list.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

describe("dispatchList", () => {
  // Isolate from user-level presets under $XDG_CONFIG_HOME/autoloop/presets
  // which listKnownPresets() would otherwise union into the result.
  const origXdg = process.env.XDG_CONFIG_HOME;
  beforeAll(() => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(
      resolve(tmpdir(), "autoloop-list-test-"),
    );
  });
  afterAll(() => {
    if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = origXdg;
  });
  it("prints each preset with its description", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchList([], bundleRoot);
    vi.restoreAllMocks();

    expect(lines.length).toBeGreaterThan(0);
    // Each line should have the preset name followed by a description
    for (const line of lines) {
      expect(line).toMatch(/^auto\w+\s{2,}\S/);
    }
    // Verify specific preset appears
    expect(lines.some((l) => l.startsWith("autocode"))).toBe(true);
  });

  it("descriptions use action-oriented 'Use when/Use after' style", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchList([], bundleRoot);
    vi.restoreAllMocks();

    for (const line of lines) {
      const desc = line.replace(/^auto\w+\s+/, "");
      expect(desc).toMatch(/^Use (when|after) /);
    }
  });

  it("prints a JSON array of {name, description} with --json", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchList(["--json"], bundleRoot);
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of parsed) {
      expect(Object.keys(entry).sort()).toEqual(["description", "name"]);
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
    }
    expect(parsed.some((e: { name: string }) => e.name === "autocode")).toBe(
      true,
    );
  });

  it("prints help with --help", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchList(["--help"], bundleRoot);
    vi.restoreAllMocks();

    expect(lines.some((l) => l.includes("Usage"))).toBe(true);
  });
});
