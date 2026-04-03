import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  skipLine,
  sliceOuter,
  stripQuotes,
  lineSep,
  splitCsv,
  parseStringList,
  parseStringListLiteralOrScalar,
  joinCsv,
} from "./utils.js";

export type Config = Record<string, unknown>;

export function loadProject(projectDir: string): Config {
  return load(resolveConfigPath(projectDir));
}

export function load(path: string): Config {
  if (!existsSync(path)) return defaults();
  return parseToml(readFileSync(path, "utf-8"));
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

function journalPath(config: Config): string {
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

function defaults(): Config {
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
  let config = defaults();
  let section = "";
  const lines = text.split(lineSep());

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (skipLine(trimmed)) continue;

    if (isSectionHeader(trimmed)) {
      section = extractSectionName(trimmed);
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      console.log("[config] warning: skipping unparseable line (no '=' found)");
      continue;
    }

    const rawKey = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const fullKey = section ? section + "." + rawKey : rawKey;
    config = put(config, fullKey, normalizeValue(rawValue));
  }

  return config;
}

function isSectionHeader(line: string): boolean {
  return line.startsWith("[") && line.endsWith("]");
}

function extractSectionName(line: string): string {
  return sliceOuter(line).trim();
}

function normalizeValue(value: string): string {
  return joinCsv(parseStringListLiteralOrScalar(value));
}
