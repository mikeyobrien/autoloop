import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import * as config from "../config.js";
import { parseStringList } from "../utils.js";
import { defaultBudget, parseBudgetFromToml } from "./budget.js";
import type { ChainStep, ChainSpec, ChainsConfig, Budget } from "./types.js";

export function load(projectDir: string): ChainsConfig {
  const path = join(projectDir, "chains.toml");
  if (!existsSync(path)) return { chains: [], budget: defaultBudget() };
  return loadExisting(path, projectDir);
}

export function resolveChain(chains: ChainsConfig, name: string): ChainSpec | null {
  return chains.chains.find((c) => c.name === name) ?? null;
}

export function listChains(chains: ChainsConfig): ChainSpec[] {
  return chains.chains;
}

export function parseInlineChain(csvSteps: string, projectDir: string): ChainSpec {
  const stepNames = parseStringList(csvSteps);
  return {
    name: "inline",
    steps: resolveSteps(stepNames, projectDir),
  };
}

export function loadBudget(projectDir: string): Budget {
  const path = join(projectDir, "chains.toml");
  if (!existsSync(path)) return defaultBudget();
  const parsed = TOML.parse(readFileSync(path, "utf-8"));
  return parseBudgetFromToml(parsed.budget);
}

export function resolvePresetDir(name: string, projectDir: string): string {
  const candidate = join(projectDir, "presets/" + name);
  if (existsSync(candidate)) return candidate;
  const cwdCandidate = join(".", "presets/" + name);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  return name;
}

export function listKnownPresets(): string[] {
  return [
    "autocode", "autosimplify", "autoideas", "autoresearch",
    "autoqa", "autotest", "autofix", "autoreview",
    "autodoc", "autosec", "autoperf", "autospec",
    "automerge",
  ];
}

export function getPresetDescription(name: string, projectDir: string): string {
  const dir = resolvePresetDir(name, projectDir);
  const readme = join(dir, "README.md");
  if (!existsSync(readme)) return "";
  const lines = readFileSync(readme, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

export interface PresetInfo {
  name: string;
  description: string;
}

export function listPresetsWithDescriptions(projectDir: string): PresetInfo[] {
  return listKnownPresets().map((name) => ({
    name,
    description: getPresetDescription(name, projectDir),
  }));
}

export function validatePresetVocabulary(
  steps: string[],
  projectDir: string,
): { ok: boolean; reason?: string } {
  const known = listKnownPresets();
  for (const name of steps) {
    if (!known.includes(name) && !config.projectHasConfig(resolvePresetDir(name, projectDir))) {
      return { ok: false, reason: "unknown preset: " + name };
    }
  }
  return { ok: true };
}

function loadExisting(path: string, projectDir: string): ChainsConfig {
  const text = readFileSync(path, "utf-8");
  const parsed = TOML.parse(text);
  return parseChainsFromToml(parsed as Record<string, unknown>, projectDir);
}

function parseChainsFromToml(parsed: Record<string, unknown>, projectDir: string): ChainsConfig {
  const rawChains = (parsed.chain ?? []) as Array<{ name?: string; steps?: string[] }>;
  const chains = rawChains
    .filter((c) => typeof c.name === "string" && c.name !== "")
    .map((c) => ({
      name: c.name as string,
      steps: resolveSteps(c.steps ?? [], projectDir),
    }));

  const budget = parseBudgetFromToml(parsed.budget);
  return { chains, budget };
}

function resolveSteps(stepNames: string[], projectDir: string): ChainStep[] {
  return stepNames.map((name) => ({
    name,
    presetDir: resolvePresetDir(name, projectDir),
  }));
}
