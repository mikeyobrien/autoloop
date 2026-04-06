import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePresetDir } from "../chains/load.js";
import type { RunRecord } from "../registry/types.js";

export type IsolationMode = "shared" | "run-scoped" | "worktree";

export interface IsolationRequest {
  worktree?: boolean;
  noWorktree?: boolean;
  configEnabled?: boolean;
  currentCategory?: PresetCategory;
}

export interface IsolationResult {
  mode: IsolationMode;
  warning?: string;
}

/**
 * Decide the isolation mode for a new run based on CLI flags,
 * config, and the state of currently active runs.
 *
 * Priority:
 *  1. Explicit --worktree flag → "worktree"
 *  2. Explicit --no-worktree flag → "shared"
 *  3. Config isolation.enabled → "worktree"
 *  4. Other active runs exist with code roles → "run-scoped" + warning
 *  5. Other active runs exist (non-code) → "run-scoped"
 *  6. Solo run → "shared"
 */
export function resolveIsolationMode(
  request: IsolationRequest,
  otherActiveRuns: RunRecord[],
): IsolationResult {
  if (request.worktree) {
    return { mode: "worktree" };
  }

  if (request.noWorktree) {
    return { mode: "shared" };
  }

  if (request.configEnabled) {
    return { mode: "worktree" };
  }

  if (otherActiveRuns.length === 0) {
    return { mode: "shared" };
  }

  const hasCodeRuns = otherActiveRuns.some((r) => isCodeModifyingRun(r));

  // Planning/read-only presets are safe to run concurrently — no warning needed
  if (request.currentCategory === "planning") {
    return { mode: "run-scoped" };
  }

  // Code or unknown presets warn when concurrent code-modifying runs exist
  if (hasCodeRuns) {
    const codeRuns = otherActiveRuns.filter((r) => isCodeModifyingRun(r));
    const runList = codeRuns.map((r) => `${r.run_id} (${r.preset})`).join(", ");
    const warning = [
      `Active code-modifying run detected: ${runList}`,
      "  Runs sharing the same checkout may produce code conflicts.",
      '  Consider: autoloop run <preset> --worktree "your prompt"',
      '  Or suppress: autoloop run <preset> --no-worktree "your prompt"',
    ].join("\n");
    return {
      mode: "run-scoped",
      warning,
    };
  }

  return { mode: "run-scoped" };
}

export type PresetCategory = "code" | "planning" | "unknown";

/**
 * Determine preset category from harness.md metadata or name heuristic.
 * Reads `<!-- category: ... -->` from harness.md if present.
 * Falls back to name-based heuristic.
 */
export function presetCategory(
  presetName: string,
  projectDir: string,
): PresetCategory {
  const presetDir = resolvePresetDir(presetName, projectDir);
  const harnessPath = join(presetDir, "harness.md");

  if (existsSync(harnessPath)) {
    const content = readFileSync(harnessPath, "utf-8");
    const match = content.match(/<!--\s*category:\s*([\w-]+)\s*-->/);
    if (match) {
      const cat = match[1].toLowerCase();
      if (cat === "code") return "code";
      if (cat === "planning") return "planning";
    }
  }

  // Name-based heuristic fallback
  const name = presetName.toLowerCase();
  const codePresets = [
    "autocode",
    "autofix",
    "autotest",
    "autosimplify",
    "autoperf",
    "autosec",
  ];
  if (codePresets.some((p) => name.includes(p))) return "code";

  const planningPresets = [
    "automerge",
    "autoideas",
    "autoresearch",
    "autodoc",
    "autoreview",
    "autoqa",
    "autospec",
  ];
  if (planningPresets.some((p) => name.includes(p))) return "planning";

  return "unknown";
}

/**
 * Heuristic: a run is "code-modifying" if its preset or objective
 * suggests it writes code (builder, autocode, fix, etc.).
 * Accepts an optional category override from preset metadata.
 * This is intentionally conservative — returns false when uncertain.
 */
export function isCodeModifyingRun(
  record: RunRecord,
  categoryOverride?: PresetCategory,
): boolean {
  if (categoryOverride === "code") return true;
  if (categoryOverride === "planning") return false;

  const preset = record.preset.toLowerCase();
  const objective = record.objective.toLowerCase();
  const codeIndicators = [
    "autocode",
    "builder",
    "fix",
    "implement",
    "refactor",
    "code",
  ];
  return codeIndicators.some(
    (ind) => preset.includes(ind) || objective.includes(ind),
  );
}
