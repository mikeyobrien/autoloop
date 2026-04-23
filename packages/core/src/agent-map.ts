/**
 * Loads and resolves per-role agent mappings from agents.toml.
 *
 * Resolution order:
 *   1. preset.<name>.<role>  (role-specific)
 *   2. preset.<name>.default (preset default)
 *   3. defaults.agent        (global fallback)
 *   4. undefined              (caller falls back to backend.agent)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";

export interface AgentMap {
  globalDefault: string;
  presets: Record<string, PresetAgentMap>;
}

export interface PresetAgentMap {
  defaultAgent: string;
  roles: Record<string, string>;
}

export function loadAgentMap(projectDir: string): AgentMap | null {
  const path = join(projectDir, "agents.toml");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  const parsed = TOML.parse(text) as Record<string, unknown>;
  return buildAgentMap(parsed);
}

export function resolveRoleAgent(
  agentMap: AgentMap | null,
  presetName: string,
  roleId: string,
): string | undefined {
  if (!agentMap) return undefined;

  const preset = agentMap.presets[presetName];
  if (preset) {
    const roleAgent = preset.roles[roleId];
    if (roleAgent) return roleAgent;
    if (preset.defaultAgent) return preset.defaultAgent;
  }

  return agentMap.globalDefault || undefined;
}

function buildAgentMap(parsed: Record<string, unknown>): AgentMap {
  const defaults = parsed["defaults"] as Record<string, unknown> | undefined;
  const globalDefault =
    typeof defaults?.["agent"] === "string" ? defaults["agent"] : "";

  const presets: Record<string, PresetAgentMap> = {};
  const presetSection = parsed["preset"] as Record<string, unknown> | undefined;
  if (presetSection) {
    for (const [name, value] of Object.entries(presetSection)) {
      if (typeof value === "object" && value !== null) {
        presets[name] = buildPresetAgentMap(value as Record<string, unknown>);
      }
    }
  }

  return { globalDefault, presets };
}

function buildPresetAgentMap(section: Record<string, unknown>): PresetAgentMap {
  const defaultAgent =
    typeof section["default"] === "string" ? section["default"] : "";
  const roles: Record<string, string> = {};
  for (const [key, value] of Object.entries(section)) {
    if (key !== "default" && typeof value === "string") {
      roles[key] = value;
    }
  }
  return { defaultAgent, roles };
}
