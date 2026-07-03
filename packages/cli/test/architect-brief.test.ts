import { describe, expect, it } from "vitest";
import { architectBrief } from "../src/commands/run.js";

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
