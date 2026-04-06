import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Role } from "./topology.js";

export interface ProfileSpec {
  scope: "repo" | "user";
  name: string;
}

export function parseProfileSpec(spec: string): ProfileSpec {
  const colonIdx = spec.indexOf(":");
  if (colonIdx < 0) {
    throw new Error(
      `invalid profile spec "${spec}": must be "repo:<name>" or "user:<name>"`,
    );
  }
  const scope = spec.slice(0, colonIdx);
  const name = spec.slice(colonIdx + 1);
  if (scope !== "repo" && scope !== "user") {
    throw new Error(
      `invalid profile scope "${scope}" in "${spec}": must be "repo" or "user"`,
    );
  }
  if (!name) {
    throw new Error(`invalid profile spec "${spec}": name cannot be empty`);
  }
  return { scope, name };
}

export function resolveProfileDir(spec: ProfileSpec, workDir: string): string {
  if (spec.scope === "repo") {
    return join(workDir, ".autoloop", "profiles", spec.name);
  }
  return join(homedir(), ".config", "autoloops", "profiles", spec.name);
}

export function resolveProfileFragments(
  profileSpecs: string[],
  presetName: string,
  roles: Role[],
  workDir: string,
): { fragments: Map<string, string>; warnings: string[] } {
  const fragments = new Map<string, string>();
  const warnings: string[] = [];
  const roleIds = new Set(roles.map((r) => r.id));

  for (const spec of profileSpecs) {
    const parsed = parseProfileSpec(spec);
    const profileDir = resolveProfileDir(parsed, workDir);

    if (!existsSync(profileDir)) {
      throw new Error(
        `profile "${spec}" not found: ${profileDir} does not exist`,
      );
    }

    const presetDir = join(profileDir, presetName);
    if (!existsSync(presetDir)) {
      warnings.push(
        `profile "${spec}" has no fragments for preset "${presetName}"`,
      );
      continue;
    }

    let contributed = false;
    const entries = readdirSync(presetDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const entry of entries) {
      const roleId = entry.replace(/\.md$/, "");
      if (!roleIds.has(roleId)) {
        warnings.push(
          `profile "${spec}" has fragment for unknown role "${roleId}" in preset "${presetName}"`,
        );
        continue;
      }
      const content = readFileSync(join(presetDir, entry), "utf-8");
      const existing = fragments.get(roleId) ?? "";
      fragments.set(roleId, `${existing}\n${content}`);
      contributed = true;
    }

    if (!contributed) {
      warnings.push(
        `profile "${spec}" contributed no fragments for preset "${presetName}"`,
      );
    }
  }

  return { fragments, warnings };
}

export function applyProfileFragments(
  roles: Role[],
  fragments: Map<string, string>,
): Role[] {
  if (fragments.size === 0) return roles;
  return roles.map((role) => {
    const fragment = fragments.get(role.id);
    if (!fragment) return role;
    return { ...role, prompt: role.prompt + fragment };
  });
}
