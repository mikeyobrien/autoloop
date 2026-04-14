import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPresetDescription,
  listKnownPresets,
  listPresetsWithDescriptions,
  parseChainsFromToml,
  validatePresetVocabulary,
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

describe("automerge preset", () => {
  it("is included in listKnownPresets", () => {
    expect(listKnownPresets()).toContain("automerge");
  });

  it("has a description", () => {
    const desc = getPresetDescription("automerge", bundleRoot);
    expect(desc.length).toBeGreaterThan(0);
  });

  it("passes vocabulary validation", () => {
    const result = validatePresetVocabulary(
      ["autocode", "automerge"],
      bundleRoot,
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseChainsFromToml — per-step backend override", () => {
  it("back-compat: string-list steps parse unchanged with no overrides", () => {
    const parsed = {
      chain: [{ name: "simple", steps: ["autocode", "autoreview"] }],
    };
    const cfg = parseChainsFromToml(parsed, bundleRoot);
    expect(cfg.chains).toHaveLength(1);
    const c = cfg.chains[0];
    expect(c.name).toBe("simple");
    expect(c.steps.map((s) => s.name)).toEqual(["autocode", "autoreview"]);
    for (const s of c.steps) expect(s.backendOverride).toBeUndefined();
  });

  it("parses structured [[chain.step]] form with per-step backend override", () => {
    const parsed = {
      chain: [
        {
          name: "plan-then-build",
          step: [
            {
              preset: "autocode",
              backend: {
                args: [
                  "--model",
                  "anthropic/claude-opus-4",
                  "--thinking",
                  "high",
                ],
              },
            },
            {
              preset: "autoreview",
              backend: { args: ["--model", "anthropic/claude-haiku-4"] },
            },
            { preset: "automerge" },
          ],
        },
      ],
    };
    const cfg = parseChainsFromToml(parsed, bundleRoot);
    const steps = cfg.chains[0].steps;
    expect(steps.map((s) => s.name)).toEqual([
      "autocode",
      "autoreview",
      "automerge",
    ]);
    expect(steps[0].backendOverride).toEqual({
      args: ["--model", "anthropic/claude-opus-4", "--thinking", "high"],
    });
    expect(steps[1].backendOverride).toEqual({
      args: ["--model", "anthropic/claude-haiku-4"],
    });
    expect(steps[2].backendOverride).toBeUndefined();
  });

  it("rejects unknown backend keys with a clear error", () => {
    const parsed = {
      chain: [
        {
          name: "bad",
          step: [{ preset: "autocode", backend: { bogus: "x" } }],
        },
      ],
    };
    expect(() => parseChainsFromToml(parsed, bundleRoot)).toThrow(
      /unknown backend keys: bogus/,
    );
  });

  it("rejects a chain that mixes 'steps' and '[[chain.step]]'", () => {
    const parsed = {
      chain: [
        {
          name: "conflicted",
          steps: ["autocode"],
          step: [{ preset: "autoreview" }],
        },
      ],
    };
    expect(() => parseChainsFromToml(parsed, bundleRoot)).toThrow(
      /cannot define both/,
    );
  });

  it("allows both forms to coexist across different chains in the same file", () => {
    const parsed = {
      chain: [
        { name: "old", steps: ["autocode"] },
        { name: "new", step: [{ preset: "autoreview" }] },
      ],
    };
    const cfg = parseChainsFromToml(parsed, bundleRoot);
    expect(cfg.chains.map((c) => c.name)).toEqual(["old", "new"]);
    expect(cfg.chains[0].steps[0].name).toBe("autocode");
    expect(cfg.chains[1].steps[0].name).toBe("autoreview");
  });
});
