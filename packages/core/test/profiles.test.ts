import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role } from "@mobrienv/autoloop-core/topology";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyProfileFragments,
  parseProfileSpec,
  resolveProfileFragments,
} from "../src/profiles.js";

const TMP_BASE = join(tmpdir(), `autoloop-ts-test-profiles-${process.pid}`);

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => mkdirSync(TMP_BASE, { recursive: true }));
afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }));

const TEST_ROLES: Role[] = [
  {
    id: "planner",
    prompt: "You are the planner.",
    promptFile: "",
    emits: ["tasks.ready"],
  },
  {
    id: "builder",
    prompt: "You are the builder.",
    promptFile: "",
    emits: ["review.ready"],
  },
  {
    id: "critic",
    prompt: "You are the critic.",
    promptFile: "",
    emits: ["review.passed"],
  },
];

describe("parseProfileSpec", () => {
  it("parses repo:name", () => {
    expect(parseProfileSpec("repo:phoenix")).toEqual({
      scope: "repo",
      name: "phoenix",
    });
  });

  it("parses user:name", () => {
    expect(parseProfileSpec("user:strict-review")).toEqual({
      scope: "user",
      name: "strict-review",
    });
  });

  it("throws on bare name without scope", () => {
    expect(() => parseProfileSpec("phoenix")).toThrow(
      'must be "repo:<name>" or "user:<name>"',
    );
  });

  it("throws on invalid scope", () => {
    expect(() => parseProfileSpec("global:phoenix")).toThrow(
      'must be "repo" or "user"',
    );
  });

  it("throws on empty name", () => {
    expect(() => parseProfileSpec("repo:")).toThrow("name cannot be empty");
  });
});

describe("resolveProfileFragments", () => {
  it("reads fragment from correct path", () => {
    const workDir = tmpDir("frag-read");
    const profileDir = join(
      workDir,
      ".autoloop",
      "profiles",
      "phoenix",
      "mypreset",
    );
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "planner.md"), "Extra planner guidance.");

    const result = resolveProfileFragments(
      ["repo:phoenix"],
      "mypreset",
      TEST_ROLES,
      workDir,
    );
    expect(result.fragments.get("planner")).toContain(
      "Extra planner guidance.",
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("composes multiple profiles in order", () => {
    const workDir = tmpDir("multi-profile");
    // Profile A
    const profileA = join(workDir, ".autoloop", "profiles", "alpha", "preset1");
    mkdirSync(profileA, { recursive: true });
    writeFileSync(join(profileA, "builder.md"), "Alpha guidance.");
    // Profile B
    const profileB = join(workDir, ".autoloop", "profiles", "beta", "preset1");
    mkdirSync(profileB, { recursive: true });
    writeFileSync(join(profileB, "builder.md"), "Beta guidance.");

    const result = resolveProfileFragments(
      ["repo:alpha", "repo:beta"],
      "preset1",
      TEST_ROLES,
      workDir,
    );
    const fragment = result.fragments.get("builder") ?? "";
    expect(fragment.indexOf("Alpha guidance.")).toBeLessThan(
      fragment.indexOf("Beta guidance."),
    );
  });

  it("throws on missing profile directory", () => {
    const workDir = tmpDir("missing-profile");
    expect(() =>
      resolveProfileFragments(
        ["repo:nonexistent"],
        "preset1",
        TEST_ROLES,
        workDir,
      ),
    ).toThrow("does not exist");
  });

  it("warns on fragment for unknown role", () => {
    const workDir = tmpDir("unknown-role");
    const profileDir = join(
      workDir,
      ".autoloop",
      "profiles",
      "test",
      "preset1",
    );
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "nonexistent-role.md"), "Ignored.");

    const result = resolveProfileFragments(
      ["repo:test"],
      "preset1",
      TEST_ROLES,
      workDir,
    );
    expect(result.warnings.some((w) => w.includes("unknown role"))).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("contributed no fragments")),
    ).toBe(true);
  });

  it("warns when profile has no matching fragments for preset", () => {
    const workDir = tmpDir("no-preset-dir");
    const profileDir = join(workDir, ".autoloop", "profiles", "empty-profile");
    mkdirSync(profileDir, { recursive: true });
    // No preset subdirectory

    const result = resolveProfileFragments(
      ["repo:empty-profile"],
      "preset1",
      TEST_ROLES,
      workDir,
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no fragments for preset");
  });

  it("warns when profile contributes nothing", () => {
    const workDir = tmpDir("no-contribution");
    const profileDir = join(
      workDir,
      ".autoloop",
      "profiles",
      "test",
      "preset1",
    );
    mkdirSync(profileDir, { recursive: true });
    // Only a file for a non-existent role
    writeFileSync(join(profileDir, "ghost.md"), "Ghost role.");

    const result = resolveProfileFragments(
      ["repo:test"],
      "preset1",
      TEST_ROLES,
      workDir,
    );
    expect(
      result.warnings.some((w) => w.includes("contributed no fragments")),
    ).toBe(true);
  });
});

describe("applyProfileFragments", () => {
  it("appends fragment to matching role prompt", () => {
    const fragments = new Map([["builder", "\nExtra builder text."]]);
    const updated = applyProfileFragments(TEST_ROLES, fragments);
    expect(updated.find((r) => r.id === "builder")?.prompt).toBe(
      "You are the builder.\nExtra builder text.",
    );
    // Other roles unchanged
    expect(updated.find((r) => r.id === "planner")?.prompt).toBe(
      "You are the planner.",
    );
  });

  it("returns same roles when no fragments", () => {
    const updated = applyProfileFragments(TEST_ROLES, new Map());
    expect(updated).toBe(TEST_ROLES);
  });
});

describe("--no-default-profiles suppression", () => {
  it("config defaults are read by getProfileDefaults", async () => {
    // This tests the config layer
    const { getProfileDefaults, loadProject } = await import(
      "../src/config.js"
    );
    const workDir = tmpDir("config-defaults");
    writeFileSync(
      join(workDir, "autoloops.toml"),
      'profiles.default = "repo:phoenix,repo:beta"\n',
    );
    const cfg = loadProject(workDir);
    expect(getProfileDefaults(cfg)).toEqual(["repo:phoenix", "repo:beta"]);
  });

  it("returns empty for missing config key", async () => {
    const { getProfileDefaults, loadProject } = await import(
      "../src/config.js"
    );
    const workDir = tmpDir("config-no-profiles");
    writeFileSync(join(workDir, "autoloops.toml"), "");
    const cfg = loadProject(workDir);
    expect(getProfileDefaults(cfg)).toEqual([]);
  });
});
