// Pure configuration schema, merge, and accessor helpers.
//
// Everything here operates on in-memory Config objects — no fs, no env, no os.
// The fs-touching layer (user/project loaders, path resolvers) lives in
// ./config.ts and re-exports the public pieces from this module so callers
// keep a single import surface (`import * as config from "./config.js"`).

import TOML from "@iarna/toml";
import { parseStringList } from "./utils.js";

export type Config = Record<string, unknown>;
export type Provenance = Record<string, string>;

export interface LayeredConfig {
  config: Config;
  provenance: Provenance;
}

export function defaults(): Config {
  return {
    event_loop: {
      max_iterations: "3",
      completion_promise: "LOOP_COMPLETE",
      completion_event: "task.complete",
      required_events: "",
    },
    backend: { kind: "", command: "claude", timeout_ms: "300000" },
    parallel: {
      enabled: "false",
      max_branches: "3",
      branch_timeout_ms: "180000",
    },
    memory: { prompt_budget_chars: "8000" },
    core: {
      state_dir: ".autoloop",
      journal_file: ".autoloop/journal.jsonl",
      events_file: ".autoloop/journal.jsonl",
      memory_file: ".autoloop/memory.jsonl",
      run_id_format: "human",
      log_level: "info",
    },
  };
}

export function get(config: Config, key: string, fallback: string): string {
  return getPath(config, key.split("."), fallback);
}

export function getInt(config: Config, key: string, fallback: number): number {
  const raw = get(config, key, "");
  if (raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getList(config: Config, key: string): string[] {
  return parseStringList(get(config, key, ""));
}

export function getProfileDefaults(cfg: Config): string[] {
  return getList(cfg, "profiles.default");
}

export function put(config: Config, key: string, value: string): Config {
  return putPath(config, key.split("."), value);
}

export function journalPath(config: Config): string {
  return get(
    config,
    "core.journal_file",
    get(config, "core.events_file", ".autoloop/journal.jsonl"),
  );
}

export function parseToml(text: string): Config {
  return deepMerge(defaults(), stringifyValues(parseRawToml(text)));
}

export function parseRawToml(text: string): Record<string, unknown> {
  return TOML.parse(text) as Record<string, unknown>;
}

export function stringifyValues(obj: Record<string, unknown>): Config {
  const result: Config = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result[key] = value.map(String).join(",");
    } else if (typeof value === "object" && value !== null) {
      result[key] = stringifyValues(value as Record<string, unknown>);
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

export function deepMerge(base: Config, override: Config): Config {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as Config, value as Config);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function recordProvenance(
  layer: Config,
  label: string,
  provenance: Provenance,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(layer)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      recordProvenance(value as Config, label, provenance, path);
    } else {
      provenance[path] = label;
    }
  }
}

function getPath(config: Config, path: string[], fallback: string): string {
  if (path.length === 0) return fallback;
  const key = path[0];
  const value = (config as Record<string, unknown>)[key];
  if (value === undefined || value === null) return fallback;
  if (path.length === 1) return String(value);
  if (typeof value === "object" && value !== null) {
    return getPath(value as Config, path.slice(1), fallback);
  }
  return fallback;
}

function putPath(config: Config, path: string[], value: string): Config {
  if (path.length === 0) return config;
  const result = { ...config };
  if (path.length === 1) {
    result[path[0]] = value;
    return result;
  }
  const inner =
    typeof result[path[0]] === "object" && result[path[0]] !== null
      ? { ...(result[path[0]] as Config) }
      : {};
  result[path[0]] = putPath(inner as Config, path.slice(1), value);
  return result;
}
