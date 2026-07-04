import type { EvidenceRequirement, EvidenceType, Gate } from "./topology.js";

/**
 * Typed-evidence parsing and validation for `[[gate]] evidence` rules. This
 * module is deliberately independent of the harness `emit()` path (and of the
 * legacy `payloadEvidenceKeys`/`missingEvidence` presence-only helpers in
 * `@mobrienv/autoloop-harness/emit`) so both topology validation and any CLI
 * inspection tooling can reuse it without a harness dependency.
 */

const STATUS_WORDS = ["passed", "failed", "failing", "passing"] as const;
type StatusWord = (typeof STATUS_WORDS)[number];

function isStatusWord(value: string): value is StatusWord {
  return (STATUS_WORDS as readonly string[]).includes(value);
}

/** Same vacuous-value rule as the legacy evidence-key scan: a non-empty
 * string, a finite number (incl. 0), or `true` counts; empty strings, `false`,
 * `null`, objects, and arrays do not. */
function isEvidenceValue(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return v === true;
  return false;
}

/** Parse a leading number out of a raw evidence value, stripping a trailing
 * `%` (e.g. `"87%"` -> `87`, `"87"` -> `87`, `"5 passed"` -> `undefined`). */
function parseNumeric(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/%$/, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** A single evidence key's parsed value from a payload. */
export interface ParsedEvidenceEntry {
  raw: string;
  numeric?: number;
  status?: string;
}

/**
 * Extract and type-parse a single evidence key from a payload. Supports:
 *
 * - JSON object payloads: `{"key": "value"}` (scalar) or
 *   `{"key": {"value": "...", "status": "passed"}}` (typed form).
 * - Token payloads: `key=value` (quoted or bare), optionally followed by a
 *   trailing status word (`key=5 passed` -> `{raw: "5 passed", numeric: 5,
 *   status: "passed"}`).
 *
 * Returns `undefined` when the key is absent or its value is vacuous.
 */
export function parseEvidenceEntry(
  payload: string,
  key: string,
): ParsedEvidenceEntry | undefined {
  if (!payload) return undefined;

  const trimmed = payload.trim();
  if (trimmed.startsWith("{")) {
    const parsed = tryParseJsonEntry(trimmed, key);
    if (parsed !== "not-json") return parsed;
    // not JSON — fall through to token scan
  }

  return parseTokenEntry(payload, key);
}

function tryParseJsonEntry(
  trimmed: string,
  key: string,
): ParsedEvidenceEntry | undefined | "not-json" {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return "not-json";
  }
  if (!Object.hasOwn(obj, key)) return undefined;

  const v = obj[key];
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>;
    const rawValue = rec.value;
    const raw =
      typeof rawValue === "string" || typeof rawValue === "number"
        ? String(rawValue)
        : "";
    if (raw.trim() === "") return undefined;
    const status = typeof rec.status === "string" ? rec.status : undefined;
    return { raw, numeric: parseNumeric(raw), status };
  }

  if (!isEvidenceValue(v)) return undefined;
  const raw = String(v);
  return { raw, numeric: parseNumeric(raw) };
}

function parseTokenEntry(
  payload: string,
  key: string,
): ParsedEvidenceEntry | undefined {
  const re =
    /([A-Za-z_][\w.-]*)=("[^"]*"|'[^']*'|[^\s,;]+)(?:\s+(passed|failed|failing|passing)\b)?/g;
  let m: RegExpExecArray | null = re.exec(payload);
  while (m !== null) {
    if (m[1] === key) {
      const raw0 = m[2].replace(/^["']|["']$/g, "").trim();
      if (raw0 === "") return undefined;
      const status = m[3] && isStatusWord(m[3]) ? m[3] : undefined;
      const raw = status ? `${raw0} ${status}` : raw0;
      return { raw, numeric: parseNumeric(raw0), status };
    }
    m = re.exec(payload);
  }
  return undefined;
}

/** Why a typed evidence requirement was not satisfied. */
export interface EvidenceShortfall {
  key: string;
  type: EvidenceType;
  reason: "missing" | "threshold" | "status";
  detail: string;
}

/**
 * Validate a single typed evidence requirement against a payload. Returns
 * `null` when satisfied, else an `EvidenceShortfall` describing why not:
 *
 * - `"missing"`: the key carries no machine-checkable value at all.
 * - `"status"` (test/lint/typecheck only): a status word was present but did
 *   not match the required status (default `"passed"`).
 * - `"threshold"` (coverage/mutation only): a numeric value was present but
 *   fell outside the configured `min`/`max` bounds.
 */
export function validateEvidenceRequirement(
  req: EvidenceRequirement,
  payload: string,
): EvidenceShortfall | null {
  const entry = parseEvidenceEntry(payload, req.key);
  if (!entry) {
    return {
      key: req.key,
      type: req.type,
      reason: "missing",
      detail: `evidence key \`${req.key}\` not found in payload`,
    };
  }

  if (req.type === "test" || req.type === "lint" || req.type === "typecheck") {
    const expected = req.status ?? "passed";
    if (entry.status !== undefined && entry.status !== expected) {
      return {
        key: req.key,
        type: req.type,
        reason: "status",
        detail: `expected status \`${expected}\`, got \`${entry.status}\``,
      };
    }
  }

  if (req.type === "coverage" || req.type === "mutation") {
    if (entry.numeric !== undefined) {
      if (req.min !== undefined && entry.numeric < req.min) {
        return {
          key: req.key,
          type: req.type,
          reason: "threshold",
          detail: `value ${entry.numeric} is below min ${req.min}`,
        };
      }
      if (req.max !== undefined && entry.numeric > req.max) {
        return {
          key: req.key,
          type: req.type,
          reason: "threshold",
          detail: `value ${entry.numeric} is above max ${req.max}`,
        };
      }
    }
  }

  return null;
}

/**
 * Routing policy for a set of evidence shortfalls: any `"missing"` shortfall
 * routes to `gate.blocked` (soft retry — evidence was never supplied). A
 * `"threshold"`/`"status"` shortfall (evidence WAS supplied but did not pass)
 * routes to `gate.failed` if configured, else falls back to `gate.blocked`
 * (back-compat safety net for gates that don't configure a `failed` topic).
 */
export function classifyGateOutcome(
  shortfalls: EvidenceShortfall[],
  gate: Pick<Gate, "blocked" | "failed">,
): string {
  if (shortfalls.some((s) => s.reason === "missing")) return gate.blocked;
  return gate.failed ?? gate.blocked;
}
