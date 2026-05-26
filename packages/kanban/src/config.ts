// Kanban config: ~/.config/autoloop/kanban.toml (honors XDG_CONFIG_HOME and
// the AUTOLOOP_KANBAN_CONFIG override). TOML surface is intentionally narrow:
//
//   default_preset     = "autocode"
//   stall_timeout_ms   = 300000
//   max_concurrent_by_column = { in_progress = 4 }
//
//   [hooks]
//   before_run = "sh -c 'npm run lint'"
//   after_run  = ""
//   timeout_ms = 60000
//
// Missing file → defaults. Parse errors log to stderr and return defaults so a
// malformed edit never wedges the dashboard.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";

export interface KanbanHooksConfig {
  before_run: string;
  after_run: string;
  timeout_ms: number;
}

export interface KanbanConfig {
  defaultPreset: string;
  stallTimeoutMs: number;
  maxConcurrentByColumn: Partial<Record<string, number>>;
  hooks: KanbanHooksConfig;
}

export const DEFAULT_KANBAN_CONFIG: KanbanConfig = {
  defaultPreset: "autocode",
  stallTimeoutMs: 300_000,
  maxConcurrentByColumn: {},
  hooks: { before_run: "", after_run: "", timeout_ms: 60_000 },
};

function cloneDefaults(): KanbanConfig {
  return {
    defaultPreset: DEFAULT_KANBAN_CONFIG.defaultPreset,
    stallTimeoutMs: DEFAULT_KANBAN_CONFIG.stallTimeoutMs,
    maxConcurrentByColumn: {},
    hooks: { ...DEFAULT_KANBAN_CONFIG.hooks },
  };
}

export function kanbanConfigPath(): string {
  const override = process.env.AUTOLOOP_KANBAN_CONFIG;
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "autoloop", "kanban.toml");
  return join(homedir(), ".config", "autoloop", "kanban.toml");
}

export function loadKanbanConfig(path?: string): KanbanConfig {
  const resolvedPath = path ?? kanbanConfigPath();
  if (!existsSync(resolvedPath)) return cloneDefaults();
  let raw: Record<string, unknown>;
  try {
    const text = readFileSync(resolvedPath, "utf-8");
    raw = TOML.parse(text) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[autoloop-kanban] config parse error ${msg}\n`);
    return cloneDefaults();
  }
  const out = cloneDefaults();
  if (typeof raw.default_preset === "string")
    out.defaultPreset = raw.default_preset;
  if (typeof raw.stall_timeout_ms === "number")
    out.stallTimeoutMs = raw.stall_timeout_ms;
  const mcbc = raw.max_concurrent_by_column;
  if (mcbc && typeof mcbc === "object" && !Array.isArray(mcbc)) {
    for (const [col, val] of Object.entries(mcbc as Record<string, unknown>)) {
      if (typeof val === "number") out.maxConcurrentByColumn[col] = val;
    }
  }
  const hooks = raw.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    const h = hooks as Record<string, unknown>;
    if (typeof h.before_run === "string") out.hooks.before_run = h.before_run;
    if (typeof h.after_run === "string") out.hooks.after_run = h.after_run;
    if (typeof h.timeout_ms === "number") out.hooks.timeout_ms = h.timeout_ms;
  }
  return out;
}
