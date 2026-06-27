// Filesystem + env layer on top of config-schema.ts.
//
// Pure helpers (defaults/get/put/deepMerge/parseToml/etc.) live in
// ./config-schema.ts and are re-exported here so existing callers that do
// `import * as config from "./config.js"` keep working unchanged.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type Config,
  deepMerge,
  defaults,
  get,
  type LayeredConfig,
  type Provenance,
  parseRawToml,
  parseToml,
  recordProvenance,
  stringifyValues,
} from "@mobrienv/autoloop-core/config-schema";
import { bundledPresetsRoot } from "./bundled-presets.js";

export type {
  Config,
  LayeredConfig,
  Provenance,
} from "@mobrienv/autoloop-core/config-schema";
export {
  deepMerge,
  defaults,
  get,
  getDuration,
  getFloat,
  getInt,
  getList,
  getProfileDefaults,
  journalPath,
  parseRawToml,
  parseToml,
  put,
  stringifyValues,
} from "@mobrienv/autoloop-core/config-schema";

export interface LoadLayeredOptions {
  presetName?: string;
  workDir?: string;
  cliOverride?: Config;
}

export function userConfigPath(): string {
  const envPath = process.env.AUTOLOOP_CONFIG;
  if (envPath) return envPath;

  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "autoloop", "config.toml");
  }

  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgHome, "autoloop", "config.toml");
}

export function userPresetsDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgHome, "autoloop", "presets");
}

export function userOverridesDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgHome, "autoloop", "overrides");
}

export function userPresetOverridePath(presetName: string): string {
  return join(userOverridesDir(), `${basename(presetName)}.toml`);
}

export function repoPresetOverridePath(
  workDir: string,
  presetName: string,
): string {
  return join(
    workDir,
    ".autoloop",
    "overrides",
    `${basename(presetName)}.toml`,
  );
}

export function hasUserConfig(): boolean {
  return existsSync(userConfigPath());
}

export function loadUserConfig(): Config {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}

export function loadLayered(
  projectDir: string,
  options: LoadLayeredOptions = {},
): LayeredConfig {
  return loadLayeredFrom(
    resolveConfigPath(projectDir),
    basename(projectDir),
    options,
  );
}

/**
 * Layered config load parameterized by the project-layer config path and the
 * default preset name. `loadLayered` (directory presets) and
 * `loadProjectFromFile` (single-file presets) both funnel through here so the
 * defaults → user → project → overrides → CLI precedence stays identical.
 */
function loadLayeredFrom(
  projectPath: string,
  defaultPresetName: string,
  options: LoadLayeredOptions = {},
): LayeredConfig {
  const base = defaults();
  const provenance: Provenance = {};
  recordProvenance(base, "default", provenance, "");

  const userCfg = loadUserConfig();
  let merged = deepMerge(base, userCfg);
  recordProvenance(userCfg, `user (${userConfigPath()})`, provenance, "");

  if (existsSync(projectPath)) {
    const projectCfg = stripTopologyKeys(
      stringifyValues(parseRawToml(readFileSync(projectPath, "utf-8"))),
    );
    merged = deepMerge(merged, projectCfg);
    recordProvenance(projectCfg, `project (${projectPath})`, provenance, "");
  }

  const presetName = options.presetName || defaultPresetName;
  const userOverridePath = userPresetOverridePath(presetName);
  if (existsSync(userOverridePath)) {
    const userOverride = stringifyValues(
      parseRawToml(readFileSync(userOverridePath, "utf-8")),
    );
    merged = deepMerge(merged, userOverride);
    recordProvenance(
      userOverride,
      `user override (${userOverridePath})`,
      provenance,
      "",
    );
  }

  if (options.workDir) {
    const repoOverridePath = repoPresetOverridePath(
      options.workDir,
      presetName,
    );
    if (existsSync(repoOverridePath)) {
      const repoOverride = stringifyValues(
        parseRawToml(readFileSync(repoOverridePath, "utf-8")),
      );
      merged = deepMerge(merged, repoOverride);
      recordProvenance(
        repoOverride,
        `repo override (${repoOverridePath})`,
        provenance,
        "",
      );
    }
  }

  if (options.cliOverride && Object.keys(options.cliOverride).length > 0) {
    merged = deepMerge(merged, options.cliOverride);
    recordProvenance(options.cliOverride, "CLI override", provenance, "");
  }

  return { config: merged, provenance };
}

export function loadProject(
  projectDir: string,
  options: LoadLayeredOptions = {},
): Config {
  return loadLayered(projectDir, options).config;
}

/**
 * Top-level keys that belong to the topology layer, not the config layer. In a
 * single-file merged-TOML preset they share the document with config tables, so
 * the config layer strips them — keeping the config map identical in shape to a
 * directory preset's (whose autoloops.toml never carries these). The topology
 * layer reads them separately via `topology.loadTopologyFromFile`.
 */
const TOPOLOGY_ONLY_KEYS = ["name", "completion", "role", "handoff", "gate"];

function stripTopologyKeys(cfg: Config): Config {
  const out: Config = {};
  for (const [key, value] of Object.entries(cfg)) {
    if (!TOPOLOGY_ONLY_KEYS.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * Load config from a single merged-TOML preset file. The file's config tables
 * (`event_loop`/`backend`/`parallel`/`hooks`/`memory`/`core`) form the project
 * layer; its topology tables are read separately by
 * `topology.loadTopologyFromFile`. The preset name (for overrides) defaults to
 * the file's basename without the `.toml` extension.
 */
export function loadProjectFromFile(
  file: string,
  options: LoadLayeredOptions = {},
): Config {
  return loadLayeredFrom(file, basename(file, ".toml"), options).config;
}

export function load(path: string): Config {
  if (!existsSync(path)) return defaults();
  return parseToml(readFileSync(path, "utf-8"));
}

export function backendOverrideFromProject(
  projectDir: string,
): Record<string, unknown> {
  const path = resolveConfigPath(projectDir);
  if (!existsSync(path)) return {};

  const parsed = parseRawToml(readFileSync(path, "utf-8"));
  const backend = parsed.backend;
  if (typeof backend !== "object" || backend === null || Array.isArray(backend))
    return {};

  const section = backend as Record<string, unknown>;
  const override: Record<string, unknown> = {};

  if (typeof section.kind === "string") override.kind = section.kind;
  if (typeof section.provider === "string")
    override.provider = section.provider;
  if (typeof section.command === "string") override.command = section.command;
  if (typeof section.prompt_mode === "string")
    override.prompt_mode = section.prompt_mode;
  if (Array.isArray(section.args))
    override.args = (section.args as unknown[]).map(String);
  if (typeof section.trust_all_tools === "boolean")
    override.trust_all_tools = section.trust_all_tools;
  if (typeof section.agent === "string") override.agent = section.agent;
  if (typeof section.model === "string") override.model = section.model;
  if (typeof section.timeout_ms === "number")
    override.timeout_ms = section.timeout_ms;

  return override;
}

export function projectHasConfig(projectDir: string): boolean {
  return (
    existsSync(join(projectDir, "autoloops.toml")) ||
    existsSync(join(projectDir, "autoloops.conf"))
  );
}

/** True when `p` is an existing single-file (`.toml`) preset. */
export function pathIsSingleFilePreset(p: string): boolean {
  if (!p.endsWith(".toml")) return false;
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * A resolved preset: either a directory preset (today's autoloops.toml +
 * topology.toml + roles/) or a single merged-TOML file. Callers thread this
 * through load sites instead of re-sniffing the filesystem.
 */
export type PresetSource =
  | { kind: "dir"; projectDir: string }
  | { kind: "file"; file: string; projectDir: string };

/**
 * Resolve a preset name or path to a tagged `PresetSource`, recognizing both
 * directory presets and single-file `.toml` presets. Returns null when nothing
 * resolves. Directory presets win over a same-named `.toml` (preserves prior
 * behavior). An explicit path to a `.toml` file resolves to a file source.
 */
export function resolvePresetSource(
  nameOrPath: string,
  bundleRoot: string,
): PresetSource | null {
  if (projectHasConfig(nameOrPath)) {
    return { kind: "dir", projectDir: nameOrPath };
  }
  if (pathIsSingleFilePreset(nameOrPath)) {
    return { kind: "file", file: nameOrPath, projectDir: dirname(nameOrPath) };
  }
  const dir = resolveBundledPresetDir(nameOrPath, bundleRoot);
  if (dir) return { kind: "dir", projectDir: dir };
  const file = resolveBundledPresetFile(nameOrPath, bundleRoot);
  if (file) return { kind: "file", file, projectDir: dirname(file) };
  return null;
}

export function resolveProjectDir(
  projectDirOrPreset: string,
  bundleRoot: string,
): string {
  if (projectHasConfig(projectDirOrPreset)) return projectDirOrPreset;
  return resolveBundledPresetDir(projectDirOrPreset, bundleRoot);
}

export function resolveJournalFile(projectDir: string): string {
  return join(projectDir, journalRelPath(projectDir));
}

export function resolveJournalFileIn(
  projectDir: string,
  workDir: string,
): string {
  return join(workDir, journalRelPath(projectDir));
}

export function resolveMemoryFile(projectDir: string): string {
  return join(projectDir, memoryRelPath(projectDir));
}

export function resolveMemoryFileIn(
  projectDir: string,
  workDir: string,
): string {
  return join(workDir, memoryRelPath(projectDir));
}

export function resolveTasksFile(projectDir: string): string {
  return join(projectDir, tasksRelPath(projectDir));
}

export function resolveTasksFileIn(
  projectDir: string,
  workDir: string,
): string {
  return join(workDir, tasksRelPath(projectDir));
}

export function stateDirName(projectDir: string): string {
  return get(loadProject(projectDir), "core.state_dir", ".autoloop");
}

export function stateDirPath(projectDir: string): string {
  return join(projectDir, stateDirName(projectDir));
}

function journalRelPath(projectDir: string): string {
  const cfg = loadProject(projectDir);
  return get(
    cfg,
    "core.journal_file",
    get(cfg, "core.events_file", ".autoloop/journal.jsonl"),
  );
}

function memoryRelPath(projectDir: string): string {
  return get(
    loadProject(projectDir),
    "core.memory_file",
    ".autoloop/memory.jsonl",
  );
}

function tasksRelPath(projectDir: string): string {
  return get(
    loadProject(projectDir),
    "core.tasks_file",
    ".autoloop/tasks.jsonl",
  );
}

function resolveBundledPresetDir(name: string, bundleRoot: string): string {
  const bundleCandidate = join(bundleRoot, `presets/${name}`);
  if (projectHasConfig(bundleCandidate)) return bundleCandidate;
  const cwdCandidate = join(".", `presets/${name}`);
  if (projectHasConfig(cwdCandidate)) return cwdCandidate;
  const userCandidate = join(userPresetsDir(), name);
  if (projectHasConfig(userCandidate)) return userCandidate;
  const bundledRoot = bundledPresetsRoot();
  if (bundledRoot) {
    const bundledCandidate = join(bundledRoot, name);
    if (projectHasConfig(bundledCandidate)) return bundledCandidate;
  }
  return "";
}

/**
 * Resolve a single-file (`<name>.toml`) preset across the same search roots as
 * `resolveBundledPresetDir`. Returns "" when none exists.
 */
function resolveBundledPresetFile(name: string, bundleRoot: string): string {
  const candidates = [
    join(bundleRoot, `presets/${name}.toml`),
    join(".", `presets/${name}.toml`),
    join(userPresetsDir(), `${name}.toml`),
  ];
  const bundledRoot = bundledPresetsRoot();
  if (bundledRoot) candidates.push(join(bundledRoot, `${name}.toml`));
  for (const candidate of candidates) {
    if (pathIsSingleFilePreset(candidate)) return candidate;
  }
  return "";
}

function resolveConfigPath(projectDir: string): string {
  const tomlPath = join(projectDir, "autoloops.toml");
  if (existsSync(tomlPath)) return tomlPath;
  return join(projectDir, "autoloops.conf");
}
