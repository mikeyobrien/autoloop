import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import * as config from "../config.js";
import { parseStringList } from "../utils.js";
import { defaultBudget, parseBudgetFromToml } from "./budget.js";
import type {
  Budget,
  ChainSpec,
  ChainStep,
  ChainsConfig,
  StepBackendOverride,
} from "./types.js";

// Keys accepted inside a per-step `backend = { ... }` table. Must match the
// subset that src/harness/config-helpers.ts::readBackendConfig reads from
// overrides.
const ALLOWED_BACKEND_OVERRIDE_KEYS = new Set([
  "kind",
  "command",
  "args",
  "prompt_mode",
  "timeout_ms",
]);

export function load(projectDir: string): ChainsConfig {
  const path = join(projectDir, "chains.toml");
  if (!existsSync(path)) return { chains: [], budget: defaultBudget() };
  return loadExisting(path, projectDir);
}

export function resolveChain(
  chains: ChainsConfig,
  name: string,
): ChainSpec | null {
  return chains.chains.find((c) => c.name === name) ?? null;
}

export function listChains(chains: ChainsConfig): ChainSpec[] {
  return chains.chains;
}

export function parseInlineChain(
  csvSteps: string,
  projectDir: string,
): ChainSpec {
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
  const candidate = join(projectDir, `presets/${name}`);
  if (existsSync(candidate)) return candidate;
  const cwdCandidate = join(".", `presets/${name}`);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  const userCandidate = join(config.userPresetsDir(), name);
  if (existsSync(userCandidate)) return userCandidate;
  return name;
}

export function listKnownPresets(): string[] {
  const builtIn = [
    "autocode",
    "autosimplify",
    "autoideas",
    "autoresearch",
    "autoqa",
    "autotest",
    "autofix",
    "autoreview",
    "autodoc",
    "autosec",
    "autoperf",
    "autospec",
    "automerge",
    "autopr",
  ];
  const userDir = config.userPresetsDir();
  if (!existsSync(userDir)) return builtIn;
  try {
    const entries = readdirSync(userDir, { withFileTypes: true });
    const userNames = entries
      .filter(
        (e) =>
          e.isDirectory() && config.projectHasConfig(join(userDir, e.name)),
      )
      .map((e) => e.name)
      .filter((n) => !builtIn.includes(n));
    return [...builtIn, ...userNames];
  } catch {
    return builtIn;
  }
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
    if (
      !known.includes(name) &&
      !config.projectHasConfig(resolvePresetDir(name, projectDir))
    ) {
      return { ok: false, reason: `unknown preset: ${name}` };
    }
  }
  return { ok: true };
}

function loadExisting(path: string, projectDir: string): ChainsConfig {
  const text = readFileSync(path, "utf-8");
  const parsed = TOML.parse(text);
  return parseChainsFromToml(parsed as Record<string, unknown>, projectDir);
}

export function parseChainsFromToml(
  parsed: Record<string, unknown>,
  projectDir: string,
): ChainsConfig {
  const rawChains = (parsed.chain ?? []) as Array<{
    name?: string;
    steps?: string[];
    step?: Array<{ preset?: string; backend?: Record<string, unknown> }>;
  }>;
  const chains = rawChains
    .filter((c) => typeof c.name === "string" && c.name !== "")
    .map((c) => {
      const name = c.name as string;
      const hasStringSteps = Array.isArray(c.steps) && c.steps.length > 0;
      const hasStructured = Array.isArray(c.step) && c.step.length > 0;

      if (hasStringSteps && hasStructured) {
        throw new Error(
          `chain "${name}": cannot define both 'steps = [...]' and '[[chain.step]]'. ` +
            `Pick one form (prefer [[chain.step]] if you need per-step backend overrides).`,
        );
      }

      if (hasStructured) {
        return {
          name,
          steps: resolveStructuredSteps(c.step ?? [], projectDir, name),
        };
      }
      return {
        name,
        steps: resolveSteps(c.steps ?? [], projectDir),
      };
    });

  const budget = parseBudgetFromToml(parsed.budget);
  return { chains, budget };
}

function resolveSteps(stepNames: string[], projectDir: string): ChainStep[] {
  return stepNames.map((name) => ({
    name,
    presetDir: resolvePresetDir(name, projectDir),
  }));
}

function resolveStructuredSteps(
  rawSteps: Array<{ preset?: string; backend?: Record<string, unknown> }>,
  projectDir: string,
  chainName: string,
): ChainStep[] {
  return rawSteps.map((raw, idx) => {
    const preset = raw.preset;
    if (typeof preset !== "string" || preset === "") {
      throw new Error(
        `chain "${chainName}" step ${idx + 1}: missing required 'preset' field`,
      );
    }
    const step: ChainStep = {
      name: preset,
      presetDir: resolvePresetDir(preset, projectDir),
    };
    if (raw.backend !== undefined) {
      step.backendOverride = validateBackendOverride(
        raw.backend,
        chainName,
        preset,
      );
    }
    return step;
  });
}

function validateBackendOverride(
  backend: unknown,
  chainName: string,
  preset: string,
): StepBackendOverride {
  if (
    backend === null ||
    typeof backend !== "object" ||
    Array.isArray(backend)
  ) {
    throw new Error(
      `chain "${chainName}" step "${preset}": 'backend' must be a table`,
    );
  }
  const entries = Object.entries(backend as Record<string, unknown>);
  const unknown = entries
    .map(([k]) => k)
    .filter((k) => !ALLOWED_BACKEND_OVERRIDE_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `chain "${chainName}" step "${preset}": unknown backend keys: ${unknown.join(
        ", ",
      )}. Allowed: ${[...ALLOWED_BACKEND_OVERRIDE_KEYS].join(", ")}`,
    );
  }
  return Object.fromEntries(entries);
}
