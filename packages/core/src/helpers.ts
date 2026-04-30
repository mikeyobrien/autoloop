/**
 * Tiny cross-cutting helpers shared by core modules (registry/isolation/worktree)
 * that would otherwise pull in forward deps on backend/chains/loops.
 */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { bundledPresetsRoot } from "./bundled-presets.js";
import { userPresetsDir } from "./config.js";

/** Normalize a backend command path to a short label (claude/pi/kiro/...). */
export function normalizeBackendLabel(command: string): string {
  if (!command) return "";
  const base = basename(command);
  if (base === "claude") return "claude";
  if (base === "pi") return "pi";
  if (base === "kiro-cli") return "kiro";
  return base || command;
}

/** Liveness probe for a pid. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a preset directory by name, searching project-local, cwd-local, and
 * user config dir (XDG).
 */
export function resolvePresetDir(name: string, projectDir: string): string {
  const candidate = join(projectDir, `presets/${name}`);
  if (existsSync(candidate)) return candidate;
  const cwdCandidate = join(".", `presets/${name}`);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  const userCandidate = join(userPresetsDir(), name);
  if (existsSync(userCandidate)) return userCandidate;
  const bundledRoot = bundledPresetsRoot();
  if (bundledRoot) {
    const bundledCandidate = join(bundledRoot, name);
    if (existsSync(bundledCandidate)) return bundledCandidate;
  }
  return name;
}
