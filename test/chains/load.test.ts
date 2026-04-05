import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  listKnownPresets,
  getPresetDescription,
  listPresetsWithDescriptions,
} from "../../src/chains/load.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

describe("getPresetDescription", () => {
  it("extracts description from a preset README", () => {
    const desc = getPresetDescription("autocode", bundleRoot);
    expect(desc).toMatch(/^Use (when|after) /);
    expect(desc.startsWith("#")).toBe(false);
  });

  it("returns empty string for non-existent preset", () => {
    const desc = getPresetDescription("nonexistent-preset-xyz", bundleRoot);
    expect(desc).toBe("");
  });
});

describe("listPresetsWithDescriptions", () => {
  it("returns all known presets with descriptions", () => {
    const presets = listPresetsWithDescriptions(bundleRoot);
    const names = presets.map((p) => p.name);
    expect(names).toEqual(listKnownPresets());
    for (const p of presets) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("description never starts with a heading marker", () => {
    const presets = listPresetsWithDescriptions(bundleRoot);
    for (const p of presets) {
      expect(p.description.startsWith("#")).toBe(false);
    }
  });
});
