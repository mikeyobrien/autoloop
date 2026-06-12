// Filesystem + env layer on top of config-schema.ts.
//
// Pure helpers (defaults/get/put/deepMerge/parseToml/etc.) live in
// ./config-schema.ts and are re-exported here so existing callers that do
// `import * as config from "./config.js"` keep working unchanged.

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
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
  const base = defaults();
  const provenance: Provenance = {};
  recordProvenance(base, "default", provenance, "");

  const userCfg = loadUserConfig();
  let merged = deepMerge(base, userCfg);
  recordProvenance(userCfg, `user (${userConfigPath()})`, provenance, "");

  const projectPath = resolveConfigPath(projectDir);
  if (existsSync(projectPath)) {
    const projectCfg = stringifyValues(
      parseRawToml(readFileSync(projectPath, "utf-8")),
    );
    merged = deepMerge(merged, projectCfg);
    recordProvenance(projectCfg, `project (${projectPath})`, provenance, "");
  }

  const presetName = options.presetName || basename(projectDir);
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

function resolveConfigPath(projectDir: string): string {
  const tomlPath = join(projectDir, "autoloops.toml");
  if (existsSync(tomlPath)) return tomlPath;
  return join(projectDir, "autoloops.conf");
}
