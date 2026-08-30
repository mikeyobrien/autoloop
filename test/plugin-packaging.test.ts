import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function skillLink(plugin: string, skill: string): string {
  return join(ROOT, "plugins", plugin, "skills", skill);
}

describe("memory plugin packaging", () => {
  it("lists autoloop-memory on the marketplace", () => {
    const marketplace = JSON.parse(
      readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8"),
    ) as {
      plugins: Array<{ name: string; source: string }>;
    };
    expect(marketplace.plugins).toEqual(
      expect.arrayContaining([
        { name: "autoloop", source: "./plugins/autoloop" },
        { name: "autoloop-memory", source: "./plugins/autoloop-memory" },
      ]),
    );
  });

  it("keeps plugin skills as symlinks to .agents/skills", () => {
    const links = [
      ["autoloop", "autoloop"],
      ["autoloop", "autoloop-acp"],
      ["autoloop-memory", "autoloop-memory"],
    ] as const;
    for (const [plugin, skill] of links) {
      const link = skillLink(plugin, skill);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(`../../../.agents/skills/${skill}`);
      expect(realpathSync(join(link, "SKILL.md"))).toBe(
        join(ROOT, ".agents", "skills", skill, "SKILL.md"),
      );
    }
  });

  it("exposes add/list/find/render in the canonical memory skill", () => {
    const skill = readFileSync(
      join(ROOT, ".agents", "skills", "autoloop-memory", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toContain("autoloop memory add");
    expect(skill).toContain("autoloop memory list");
    expect(skill).toContain("autoloop memory find");
    expect(skill).toContain("memory.kind");
  });
});
