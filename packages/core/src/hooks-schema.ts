// Lifecycle hooks engine: pure types + parsing for phase-anchored hooks and
// durable suspend state. Everything here operates on plain data (raw parsed
// TOML, in-memory records) — no fs, no process spawning. The fs-touching
// pieces (spawning hook commands, writing suspend-state.json) live in
// `@mobrienv/autoloop-harness`.

/** Phase-anchored hook points. */
export type HookPhase =
  | "pre_run"
  | "post_run"
  | "pre_iteration"
  | "post_iteration"
  | "pre_emit"
  | "post_emit";

export const HOOK_PHASES: HookPhase[] = [
  "pre_run",
  "post_run",
  "pre_iteration",
  "post_iteration",
  "pre_emit",
  "post_emit",
];

/** Per-hook error policy: how a non-zero exit is routed. */
export type HookOnError = "block" | "warn" | "suspend";

export const HOOK_ON_ERRORS: HookOnError[] = ["block", "warn", "suspend"];

/** What (if anything) a hook's stdout may mutate. */
export type HookMutate = "none" | "prompt" | "event";

export const HOOK_MUTATES: HookMutate[] = ["none", "prompt", "event"];

export interface HookSpec {
  phase: HookPhase;
  command: string;
  onError: HookOnError;
  mutate: HookMutate;
  /** Source of this spec, for `hooks show`/debugging: "legacy" or "hook[<i>]". */
  source: string;
}

export interface HookSpecError {
  index: number;
  field: string;
  value: unknown;
  message: string;
}

const LEGACY_PHASE_KEYS: Record<string, HookPhase> = {
  pre_run: "pre_run",
  pre_iteration: "pre_iteration",
  post_iteration: "post_iteration",
  post_run: "post_run",
};

/**
 * Parse hook specs from a raw (un-stringified) TOML tree: the legacy flat
 * `[hooks]` keys plus the richer `[[hook]]` array-of-tables form. Order is
 * legacy first (in fixed phase order), then `[[hook]]` entries in file order —
 * both are preserved per-phase by `hooksForPhase`.
 *
 * `strict=true` (legacy `[hooks].strict`) upgrades a legacy `pre_run` hook's
 * error policy to `block`, preserving the pre-existing "strict mode aborts on
 * pre_run failure" behavior.
 */
export function parseHookSpecs(raw: Record<string, unknown>): HookSpec[] {
  const specs: HookSpec[] = [];

  const legacyHooks = asRecord(raw.hooks);
  const strict = legacyHooks ? truthy(legacyHooks.strict) : false;
  if (legacyHooks) {
    for (const [key, phase] of Object.entries(LEGACY_PHASE_KEYS)) {
      const command = legacyHooks[key];
      if (typeof command === "string" && command.trim() !== "") {
        specs.push({
          phase,
          command,
          onError: strict && phase === "pre_run" ? "block" : "warn",
          mutate: "none",
          source: "legacy",
        });
      }
    }
  }

  const hookTables = raw.hook;
  if (Array.isArray(hookTables)) {
    hookTables.forEach((entry, index) => {
      const table = asRecord(entry);
      if (!table) return;
      const phase = table.phase;
      const command = table.command;
      if (typeof phase !== "string" || !isHookPhase(phase)) return;
      if (typeof command !== "string" || command.trim() === "") return;
      const onErrorRaw = table.on_error;
      const mutateRaw = table.mutate;
      specs.push({
        phase,
        command,
        onError: isHookOnError(onErrorRaw) ? onErrorRaw : "warn",
        mutate: isHookMutate(mutateRaw) ? mutateRaw : "none",
        source: `hook[${index}]`,
      });
    });
  }

  return specs;
}

/** Specs for a single phase, in declaration order. */
export function hooksForPhase(specs: HookSpec[], phase: HookPhase): HookSpec[] {
  return specs.filter((s) => s.phase === phase);
}

export function isHookPhase(value: unknown): value is HookPhase {
  return typeof value === "string" && (HOOK_PHASES as string[]).includes(value);
}

export function isHookOnError(value: unknown): value is HookOnError {
  return (
    typeof value === "string" && (HOOK_ON_ERRORS as string[]).includes(value)
  );
}

export function isHookMutate(value: unknown): value is HookMutate {
  return (
    typeof value === "string" && (HOOK_MUTATES as string[]).includes(value)
  );
}

/**
 * Validate the raw `[[hook]]` array-of-tables entries, surfacing unknown
 * phase/on_error/mutate values and missing commands as typed errors (used by
 * `autoloop hooks validate`). Legacy flat keys are always valid by
 * construction, so this only inspects `[[hook]]`.
 */
export function validateHookSpecs(
  raw: Record<string, unknown>,
): HookSpecError[] {
  const errors: HookSpecError[] = [];
  const hookTables = raw.hook;
  if (!Array.isArray(hookTables)) return errors;

  hookTables.forEach((entry, index) => {
    const table = asRecord(entry);
    if (!table) {
      errors.push({
        index,
        field: "hook",
        value: entry,
        message: `[[hook]] entry ${index} must be a table`,
      });
      return;
    }
    if (!isHookPhase(table.phase)) {
      errors.push({
        index,
        field: "phase",
        value: table.phase,
        message: `[[hook]] entry ${index}: phase must be one of ${HOOK_PHASES.join(", ")} (got ${JSON.stringify(table.phase)})`,
      });
    }
    if (typeof table.command !== "string" || table.command.trim() === "") {
      errors.push({
        index,
        field: "command",
        value: table.command,
        message: `[[hook]] entry ${index}: command must be a non-empty string`,
      });
    }
    if (table.on_error !== undefined && !isHookOnError(table.on_error)) {
      errors.push({
        index,
        field: "on_error",
        value: table.on_error,
        message: `[[hook]] entry ${index}: on_error must be one of ${HOOK_ON_ERRORS.join(", ")} (got ${JSON.stringify(table.on_error)})`,
      });
    }
    if (table.mutate !== undefined && !isHookMutate(table.mutate)) {
      errors.push({
        index,
        field: "mutate",
        value: table.mutate,
        message: `[[hook]] entry ${index}: mutate must be one of ${HOOK_MUTATES.join(", ")} (got ${JSON.stringify(table.mutate)})`,
      });
    }
  });

  return errors;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

// --- Durable suspend state -------------------------------------------------

export const SUSPEND_STATE_SCHEMA_VERSION = 1;

export interface SuspendState {
  schemaVersion: number;
  runId: string;
  /** Phase the suspending hook ran at. */
  phase: HookPhase;
  /** Iteration number in flight when the suspend was requested (0 for pre_run/post_run). */
  iteration: number;
  reason: string;
  hookCommand: string;
  createdAt: string;
  /** Iteration to resume at once `resume-requested` is observed. */
  resumeIteration: number;
}

export function isSuspendState(value: unknown): value is SuspendState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === "number" &&
    typeof v.runId === "string" &&
    isHookPhase(v.phase) &&
    typeof v.iteration === "number" &&
    typeof v.reason === "string" &&
    typeof v.hookCommand === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.resumeIteration === "number"
  );
}
