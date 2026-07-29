import { describe, expect, it } from "vitest";
import {
  architectBrief,
  generatedPresetConfigOverride,
} from "../src/commands/run.js";

describe("architectBrief", () => {
  it("includes the objective, standard intensity, the output path, and no-ceiling note", () => {
    const brief = architectBrief(
      "harden the auth module",
      false,
      "/work/.autoloop/generated-preset.toml",
    );
    expect(brief).toContain("intensity=standard");
    expect(brief).toContain("No budget ceiling set");
    expect(brief).toContain("EXACTLY /work/.autoloop/generated-preset.toml");
    expect(brief).toContain("Objective: harden the auth module");
  });

  it("marks ultra intensity and threads the budget when set", () => {
    const brief = architectBrief("audit", true, "/w/p.toml", "5.00");
    expect(brief).toContain("intensity=ultra");
    expect(brief).toContain("$5.00");
    expect(brief).toContain("hard ceiling");
  });
});

describe("generatedPresetConfigOverride", () => {
  it("gives Ultra stage branches enough wall-clock time by default", () => {
    expect(generatedPresetConfigOverride({}, true)).toEqual({
      stage_runtime: { branch_timeout_ms: "1500000" },
      backend: { timeout_ms: "1500000" },
    });
  });

  it("does not alter standard runs or override new and legacy explicit timeouts", () => {
    expect(generatedPresetConfigOverride({}, false)).toEqual({});
    const explicit = { stage_runtime: { branch_timeout_ms: "2100000" } };
    expect(generatedPresetConfigOverride(explicit, true)).toEqual({
      ...explicit,
      backend: { timeout_ms: "1500000" },
    });
    const legacy = { stage: { branch_timeout_ms: "900000" } };
    expect(generatedPresetConfigOverride(legacy, true)).toEqual({
      ...legacy,
      backend: { timeout_ms: "1500000" },
    });
    const explicitBackend = { backend: { timeout_ms: "900000" } };
    expect(generatedPresetConfigOverride(explicitBackend, true)).toEqual({
      ...explicitBackend,
      stage_runtime: { branch_timeout_ms: "1500000" },
    });
  });

  it("does not lower longer timeouts already present in the generated preset", () => {
    const effective = {
      stage_runtime: { branch_timeout_ms: "2100000" },
      backend: { timeout_ms: "2100000" },
    };
    expect(generatedPresetConfigOverride({}, true, effective)).toEqual({});
  });
});
