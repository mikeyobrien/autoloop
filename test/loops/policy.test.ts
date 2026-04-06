import { describe, it, expect } from "vitest";
import { policyForPreset } from "../../src/loops/policy.js";

describe("policyForPreset", () => {
  it("gives autospec a looser threshold than autosimplify", () => {
    const autospec = policyForPreset("autospec");
    const autosimplify = policyForPreset("autosimplify");
    expect(autospec.stuckAfterMs).toBeGreaterThan(autosimplify.stuckAfterMs);
    expect(autospec.warningAfterMs).toBeGreaterThan(autosimplify.warningAfterMs);
  });

  it("falls back to default policy for unknown presets", () => {
    const policy = policyForPreset("mystery-preset");
    expect(policy.label).toBe("default");
    expect(policy.stuckAfterMs).toBe(10 * 60 * 1000);
    expect(policy.warningAfterMs).toBe(5 * 60 * 1000);
  });

  it("resolves all named presets to labeled policies", () => {
    const names = ["autospec", "autocode", "autosimplify", "autoqa", "autofix"];
    for (const name of names) {
      const policy = policyForPreset(name);
      expect(policy.label).toBe(name);
      expect(policy.stuckAfterMs).toBeGreaterThan(policy.warningAfterMs);
    }
  });
});
