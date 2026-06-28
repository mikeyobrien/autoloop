// Pure configuration schema, merge, and accessor helpers.
//
// Everything here operates on in-memory Config objects — no fs, no env, no os.
// The fs-touching layer (user/project loaders, path resolvers) lives in
// ./config.ts and re-exports the public pieces from this module so callers
// keep a single import surface (`import * as config from "./config.js"`).

import TOML from "@iarna/toml";
import { MAX_TIMER_MS, parseDurationMs } from "./duration.js";
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
      // Stop after N consecutive identical backend outputs (0 = disabled).
      stall_iterations: "0",
      // Stop once journaled run cost reaches this USD budget (0 = disabled).
      max_cost_usd: "0",
      // Per-iteration runtime cap ("3d", "90m", or ms int; 0 = use backend.timeout_ms).
      max_iteration_runtime: "0",
      // Loop wall-clock budget ("12h", "3d", or ms int; 0 = disabled).
      max_runtime: "0",
      // Human-in-the-loop: when an agent emits this event, the loop blocks for
      // an operator response (via the `respond` control verb) up to ask_timeout,
      // then injects the answer into the next prompt. Empty ask_event disables.
      ask_event: "human.ask",
      ask_timeout: "5m",
    },
    backend: {
      kind: "",
      command: "claude",
      timeout_ms: "300000",
      // CSV of tool names to remove from the claude-sdk agent (e.g.
      // "WebFetch,WebSearch"). Empty = no restriction.
      disallowed_tools: "",
    },
    parallel: {
      enabled: "false",
      max_branches: "3",
      branch_timeout_ms: "180000",
    },
    hooks: {
      pre_run: "",
      pre_iteration: "",
      post_iteration: "",
      post_run: "",
      strict: "false",
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

export function getFloat(
  config: Config,
  key: string,
  fallback: number,
): number {
  const raw = get(config, key, "");
  if (raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Duration accessor: accepts "3d"/"1h30m"-style strings or bare millisecond
 * integers. Missing or unparseable values fall back (matching getInt/getFloat);
 * results are clamped to MAX_TIMER_MS so every timer consumer stays valid.
 */
export function getDuration(
  config: Config,
  key: string,
  fallbackMs: number,
): number {
  const raw = get(config, key, "");
  if (raw === "") return fallbackMs;
  const parsed = parseDurationMs(raw);
  if (parsed === null) return fallbackMs;
  return Math.min(parsed, MAX_TIMER_MS);
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
