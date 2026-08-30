import * as config from "./config.js";
import type { MemoryStats } from "./memory.js";
import * as memory from "./memory.js";
import type { TwoTierMemoryStats } from "./memory-render.js";

export const DEFAULT_MEMORY_KIND = "jsonl";

export interface MemoryPlugin {
  readonly kind: string;
  addLearning(projectDir: string, text: string, source: string): void;
  addPreference(projectDir: string, category: string, text: string): void;
  addMeta(projectDir: string, key: string, value: string): void;
  addRunLearning(stateDir: string, text: string, source: string): void;
  addRunMeta(stateDir: string, key: string, value: string): void;
  remove(projectDir: string, id: string, reason: string): void;
  removeFromEither(
    projectDir: string,
    stateDir: string,
    id: string,
    reason: string,
  ): void;
  promote(projectDir: string, stateDir: string, id: string): void;
  list(projectDir: string, stateDir?: string): string;
  find(projectDir: string, pattern: string, stateDir?: string): string;
  status(projectDir: string, stateDir?: string): string;
  render(projectPath: string, runPath: string, budgetChars: number): string;
  stats(
    projectPath: string,
    runPath: string,
    budgetChars: number,
  ): TwoTierMemoryStats;
  statsProject(projectDir: string, budgetChars: number): MemoryStats;
  raw(projectDir: string): string;
  compact(projectDir: string): memory.CompactSummary;
  prune(projectDir: string, maxAgeDays: number): memory.PruneSummary;
}

const registry = new Map<string, MemoryPlugin>();

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
    throw new Error(`unknown memory plugin kind: ${resolved}`);
  }
  return plugin;
}

export function resolveMemoryPluginForProject(
  projectDir: string,
): MemoryPlugin {
  const cfg = config.loadProject(projectDir);
  return resolveMemoryPlugin(
    config.get(cfg, "memory.kind", DEFAULT_MEMORY_KIND),
  );
}
