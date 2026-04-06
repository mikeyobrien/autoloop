import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";
import { parseStringList } from "./utils.js";

export type Config = Record<string, unknown>;

export type Provenance = Record<string, string>;

export interface LayeredConfig {
  config: Config;
  provenance: Provenance;
}

export function userConfigPath(): string {
  const envPath = process.env["AUTOLOOP_CONFIG"];
  if (envPath) return envPath;
  return join(homedir(), ".config", "autoloop", "config.toml");
}

export function hasUserConfig(): boolean {
  return existsSync(userConfigPath());
}

export function loadUserConfig(): Config {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}

export function loadLayered(projectDir: string): LayeredConfig {
  const base = defaults();
  const provenance: Provenance = {};

  // Track which keys come from defaults
  recordProvenance(base, "default", provenance, "");

  // Layer 1: user config
  const userCfg = loadUserConfig();
  let merged = deepMerge(base, userCfg);
  recordProvenance(userCfg, "user (" + userConfigPath() + ")", provenance, "");

  // Layer 2: project config
  const projectPath = resolveConfigPath(projectDir);
  if (existsSync(projectPath)) {
    const projectCfg = stringifyValues(parseRawToml(readFileSync(projectPath, "utf-8")));
    merged = deepMerge(merged, projectCfg);
    recordProvenance(projectCfg, "project (" + projectPath + ")", provenance, "");
  }

  return { config: merged, provenance };
}

function recordProvenance(
  layer: Config,
  label: string,
  provenance: Provenance,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(layer)) {
    const path = prefix ? prefix + "." + key : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      recordProvenance(value as Config, label, provenance, path);
    } else {
      provenance[path] = label;
    }
  }
}

export function loadProject(projectDir: string): Config {
  return loadLayered(projectDir).config;
}

export function load(path: string): Config {
  if (!existsSync(path)) return defaults();
  return parseToml(readFileSync(path, "utf-8"));
}

export function backendOverrideFromProject(projectDir: string): Record<string, unknown> {
  const path = resolveConfigPath(projectDir);
  if (!existsSync(path)) return {};

  const parsed = parseRawToml(readFileSync(path, "utf-8"));
  const backend = parsed["backend"];
  if (typeof backend !== "object" || backend === null || Array.isArray(backend)) return {};

  const section = backend as Record<string, unknown>;
  const override: Record<string, unknown> = {};

  if (typeof section["kind"] === "string") override["kind"] = section["kind"];
  if (typeof section["command"] === "string") override["command"] = section["command"];
  if (typeof section["prompt_mode"] === "string") override["prompt_mode"] = section["prompt_mode"];
  if (Array.isArray(section["args"])) override["args"] = (section["args"] as unknown[]).map(String);

  return override;
}

export function get(config: Config, key: string, fallback: string): string {
  const parts = key.split(".");
  return getPath(config, parts, fallback);
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

export function getInt(
  config: Config,
  key: string,
  fallback: number,
): number {
  const raw = get(config, key, "");
  if (raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export function getList(config: Config, key: string): string[] {
  return parseStringList(get(config, key, ""));
}

export function getProfileDefaults(cfg: Config): string[] {
  return getList(cfg, "profiles.default");
}

export function put(config: Config, key: string, value: string): Config {
  const parts = key.split(".");
  return putPath(config, parts, value);
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

export function projectHasConfig(projectDir: string): boolean {
  return (
    existsSync(join(projectDir, "autoloops.toml")) ||
    existsSync(join(projectDir, "autoloops.conf"))
  );
}

export function resolveProjectDir(
  projectDirOrPreset: string,
  bundleRoot: string,
): string {
  if (projectHasConfig(projectDirOrPreset)) return projectDirOrPreset;
  return resolveBundledPresetDir(projectDirOrPreset, bundleRoot);
}

export function resolveJournalFile(projectDir: string): string {
  const config = loadProject(projectDir);
  return join(projectDir, journalPath(config));
}

export function resolveJournalFileIn(
  projectDir: string,
  workDir: string,
): string {
  const config = loadProject(projectDir);
  return join(workDir, journalPath(config));
}

export function resolveEventsFile(projectDir: string): string {
  return resolveJournalFile(projectDir);
}

export function resolveMemoryFile(projectDir: string): string {
  const config = loadProject(projectDir);
  return join(
    projectDir,
    get(config, "core.memory_file", ".autoloop/memory.jsonl"),
  );
}

export function resolveMemoryFileIn(
  projectDir: string,
  workDir: string,
): string {
  const config = loadProject(projectDir);
  return join(
    workDir,
    get(config, "core.memory_file", ".autoloop/memory.jsonl"),
  );
}

export function stateDirName(projectDir: string): string {
  const config = loadProject(projectDir);
  return get(config, "core.state_dir", ".autoloop");
}

export function stateDirPath(projectDir: string): string {
  return join(projectDir, stateDirName(projectDir));
}

export function journalPath(config: Config): string {
  return get(
    config,
    "core.journal_file",
    get(config, "core.events_file", ".autoloop/journal.jsonl"),
  );
}

function resolveBundledPresetDir(name: string, bundleRoot: string): string {
  const bundleCandidate = join(bundleRoot, "presets/" + name);
  if (projectHasConfig(bundleCandidate)) return bundleCandidate;
  const cwdCandidate = join(".", "presets/" + name);
  if (projectHasConfig(cwdCandidate)) return cwdCandidate;
  return "";
}

function resolveConfigPath(projectDir: string): string {
  const tomlPath = join(projectDir, "autoloops.toml");
  if (existsSync(tomlPath)) return tomlPath;
  return join(projectDir, "autoloops.conf");
}

export function defaults(): Config {
  return {
    event_loop: {
      max_iterations: "3",
      completion_promise: "LOOP_COMPLETE",
      completion_event: "task.complete",
      required_events: "",
    },
    backend: { kind: "pi", command: "pi", timeout_ms: "300000" },
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
      run_id_format: "compact",
      log_level: "info",
    },
  };
}

function parseToml(text: string): Config {
  const parsed = parseRawToml(text);
  return deepMerge(defaults(), stringifyValues(parsed));
}

function parseRawToml(text: string): Record<string, unknown> {
  return TOML.parse(text) as Record<string, unknown>;
}

function stringifyValues(obj: Record<string, unknown>): Config {
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

function deepMerge(base: Config, override: Config): Config {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === "object" && value !== null && !Array.isArray(value) &&
      typeof result[key] === "object" && result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as Config, value as Config);
    } else {
      result[key] = value;
    }
  }
  return result;
}
