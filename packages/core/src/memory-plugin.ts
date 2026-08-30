import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import * as config from "./config.js";
import type { CompactSummary, MemoryStats, PruneSummary } from "./memory.js";
import * as memory from "./memory.js";
import type { TwoTierMemoryStats } from "./memory-render.js";

export const DEFAULT_MEMORY_KIND = "jsonl";

/**
 * External stores (Honcho, SuperMemory, Mnemosyne, …) implement the four
 * verbs a loop needs: add / list / find / render. jsonl-only verbs
 * (compact, prune, promote, two-tier run writes) are optional.
 */
export interface MemoryPlugin {
  readonly kind: string;
  addLearning(projectDir: string, text: string, source: string): void;
  addPreference(projectDir: string, category: string, text: string): void;
  addMeta?(projectDir: string, key: string, value: string): void;
  addRunLearning?(stateDir: string, text: string, source: string): void;
  addRunMeta?(stateDir: string, key: string, value: string): void;
  remove(projectDir: string, id: string, reason: string): void;
  removeFromEither?(
    projectDir: string,
    stateDir: string,
    id: string,
    reason: string,
  ): void;
  promote?(projectDir: string, stateDir: string, id: string): void;
  list(projectDir: string, stateDir?: string): string;
  find(projectDir: string, pattern: string, stateDir?: string): string;
  status?(projectDir: string, stateDir?: string): string;
  render(projectPath: string, runPath: string, budgetChars: number): string;
  stats?(
    projectPath: string,
    runPath: string,
    budgetChars: number,
  ): TwoTierMemoryStats;
  statsProject?(projectDir: string, budgetChars: number): MemoryStats;
  raw?(projectDir: string): string;
  compact?(projectDir: string): CompactSummary;
  prune?(projectDir: string, maxAgeDays: number): PruneSummary;
}

export interface MemoryPluginLoadContext {
  projectDir: string;
  kind: string;
}

export type MemoryPluginFactory = (
  ctx: MemoryPluginLoadContext,
) => MemoryPlugin;

const registry = new Map<string, MemoryPlugin>();
const loadedModules = new Map<string, MemoryPlugin>();

function jsonlPlugin(kind: string): MemoryPlugin {
  return {
    kind,
    addLearning: memory.addLearning,
    addPreference: memory.addPreference,
    addMeta: memory.addMeta,
    addRunLearning: memory.addRunLearning,
    addRunMeta: memory.addRunMeta,
    remove: memory.remove,
    removeFromEither: memory.removeFromEither,
    promote: memory.promote,
    list(projectDir, stateDir) {
      if (stateDir) {
        return memory.renderTwoTier(
          memory.resolveFile(projectDir),
          memory.resolveRunFile(stateDir),
          0,
        );
      }
      return memory.listProject(projectDir);
    },
    find(projectDir, pattern, stateDir) {
      const projResult = memory.findProject(projectDir, pattern);
      if (!stateDir) return projResult;
      const runResult = memory.findInFile(
        memory.resolveRunFile(stateDir),
        pattern,
      );
      const parts = [projResult, runResult].filter(
        (result) => !result.startsWith("No active"),
      );
      return parts.length > 0 ? parts.join("\n") : projResult;
    },
    status(projectDir, stateDir) {
      if (!stateDir) return memory.statusProject(projectDir);
      const stats = memory.statsTwoTier(
        memory.resolveFile(projectDir),
        memory.resolveRunFile(stateDir),
        0,
      );
      const project = stats.project;
      const run = stats.run;
      const total =
        project.preferences.length +
        project.learnings.length +
        project.meta.length +
        run.preferences.length +
        run.learnings.length +
        run.meta.length;
      return `Memory: ${stats.combinedRenderedChars} chars rendered. ${total} entries active (project: ${project.preferences.length} prefs, ${project.learnings.length} learnings, ${project.meta.length} meta; run: ${run.learnings.length} learnings, ${run.meta.length} meta).`;
    },
    render: memory.renderTwoTier,
    stats: memory.statsTwoTier,
    statsProject: memory.statsProject,
    raw: memory.rawProject,
    compact: memory.compactMemory,
    prune: memory.pruneMemory,
  };
}

const builtins: MemoryPlugin[] = [
  jsonlPlugin(DEFAULT_MEMORY_KIND),
  jsonlPlugin("file"),
];

function installBuiltins(): void {
  registry.clear();
  loadedModules.clear();
  for (const plugin of builtins) {
    registry.set(plugin.kind, plugin);
  }
}

installBuiltins();

export function registerMemoryPlugin(plugin: MemoryPlugin): void {
  const kind = plugin.kind.trim();
  if (!kind) {
    throw new Error("memory plugin kind is required");
  }
  registry.set(kind, plugin);
}

export function resetMemoryPlugins(): void {
  installBuiltins();
}

export function listMemoryPluginKinds(): string[] {
  return [...registry.keys()].sort();
}

export function normalizeMemoryKind(kind?: string): string {
  const trimmed = kind?.trim() ?? "";
  return trimmed || DEFAULT_MEMORY_KIND;
}

export function resolveMemoryPlugin(kind?: string): MemoryPlugin {
  const resolved = normalizeMemoryKind(kind);
  const plugin = registry.get(resolved);
  if (!plugin) {
    throw new Error(
      `unknown memory plugin kind: ${resolved}. Set memory.module to a package or path that exports a MemoryPlugin (Honcho, SuperMemory, Mnemosyne, …), or registerMemoryPlugin().`,
    );
  }
  return plugin;
}

export function resolveMemoryPluginForProject(
  projectDir: string,
): MemoryPlugin {
  const cfg = config.loadProject(projectDir);
  return resolveConfiguredMemoryPlugin({
    projectDir,
    kind: config.get(cfg, "memory.kind", DEFAULT_MEMORY_KIND),
    module: config.get(cfg, "memory.module", ""),
  });
}

export function resolveConfiguredMemoryPlugin(opts: {
  projectDir: string;
  kind?: string;
  module?: string;
}): MemoryPlugin {
  const kind = normalizeMemoryKind(opts.kind);
  const moduleSpec = opts.module?.trim() ?? "";
  if (moduleSpec) {
    return loadMemoryPluginFromModule(opts.projectDir, moduleSpec, kind);
  }
  return resolveMemoryPlugin(kind);
}

export function loadMemoryPluginFromModule(
  projectDir: string,
  moduleSpec: string,
  kind?: string,
): MemoryPlugin {
  const resolvedKind = normalizeMemoryKind(kind);
  const cacheKey = `${resolve(projectDir)}::${moduleSpec}::${resolvedKind}`;
  const cached = loadedModules.get(cacheKey);
  if (cached) return cached;

  const loaded = requireMemoryModule(projectDir, moduleSpec);
  const plugin = instantiateMemoryPlugin(loaded, {
    projectDir,
    kind: resolvedKind,
  });
  const selected: MemoryPlugin = { ...plugin, kind: resolvedKind };
  registerMemoryPlugin(selected);
  loadedModules.set(cacheKey, selected);
  return selected;
}

function requireMemoryModule(projectDir: string, spec: string): unknown {
  const id =
    spec.startsWith(".") || isAbsolute(spec) ? resolve(projectDir, spec) : spec;
  const requireFrom = createRequire(requireRoot(projectDir));
  try {
    return requireFrom(id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to load memory plugin module ${spec}: ${detail}`);
  }
}

function requireRoot(projectDir: string): string {
  const pkg = join(projectDir, "package.json");
  if (existsSync(pkg)) return pkg;
  return join(projectDir, "autoloops.toml");
}

function instantiateMemoryPlugin(
  loaded: unknown,
  ctx: MemoryPluginLoadContext,
): MemoryPlugin {
  if (typeof loaded === "function") {
    return assertMemoryPlugin((loaded as MemoryPluginFactory)(ctx), ctx.kind);
  }
  if (loaded && typeof loaded === "object") {
    const exports = loaded as Record<string, unknown>;
    if (typeof exports.createMemoryPlugin === "function") {
      return assertMemoryPlugin(
        (exports.createMemoryPlugin as MemoryPluginFactory)(ctx),
        ctx.kind,
      );
    }
    if (exports.default !== undefined && exports.default !== loaded) {
      return instantiateMemoryPlugin(exports.default, ctx);
    }
    if (exports.plugin !== undefined && exports.plugin !== loaded) {
      return instantiateMemoryPlugin(exports.plugin, ctx);
    }
    if (isMemoryPluginShape(exports)) {
      return exports as unknown as MemoryPlugin;
    }
  }
  throw new Error(
    `memory module for kind ${ctx.kind} did not export a MemoryPlugin (export createMemoryPlugin, default, plugin, or the plugin object)`,
  );
}

function isMemoryPluginShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.addLearning === "function" &&
    typeof value.addPreference === "function" &&
    typeof value.list === "function" &&
    typeof value.find === "function" &&
    typeof value.render === "function" &&
    typeof value.remove === "function"
  );
}

function assertMemoryPlugin(value: unknown, kind: string): MemoryPlugin {
  if (
    !value ||
    typeof value !== "object" ||
    !isMemoryPluginShape(value as Record<string, unknown>)
  ) {
    throw new Error(
      `memory module for kind ${kind} did not return a MemoryPlugin`,
    );
  }
  return value as MemoryPlugin;
}

const emptyMaterialized = {
  preferences: [] as string[],
  learnings: [] as string[],
  meta: [] as string[],
};

export function memoryPluginStats(
  plugin: MemoryPlugin,
  projectPath: string,
  runPath: string,
  budgetChars: number,
): TwoTierMemoryStats {
  if (plugin.stats) return plugin.stats(projectPath, runPath, budgetChars);
  const text = plugin.render(projectPath, runPath, budgetChars);
  return {
    project: emptyMaterialized,
    run: emptyMaterialized,
    combinedRenderedChars: text.length,
    budgetChars,
    truncated: budgetChars > 0 && text.length > budgetChars,
  };
}
