import { describe, it, expect } from "vitest";
import { parseInlineChain, validatePresetVocabulary } from "../../src/chains.js";

describe("chains facade", () => {
  it("parses inline chain steps", () => {
    const spec = parseInlineChain("autocode,autoqa", ".");
    expect(spec.name).toBe("inline");
    expect(spec.steps.map((s) => s.name)).toEqual(["autocode", "autoqa"]);
  });

  it("validates known preset vocabulary", () => {
    const result = validatePresetVocabulary(["autocode", "autoqa"], ".");
    expect(result.ok).toBe(true);
  });
});
