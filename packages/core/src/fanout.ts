// Fan-out reduction primitives for dynamic-workflow presets.
//
// A fan-out stage runs N branches concurrently (judge panel, multi-lens verify,
// finder pool). Each branch emits a structured result; the harness then REDUCES
// those results into a single routing decision. Following the design (RFC
// docs/rfcs/2026-06-24-dynamic-presets-design.md): structural reduction is
// deterministic code here (no LLM call), and only genuine semantic merge is left
// to a synthesizer role. These functions are pure so they are fully testable.

/**
 * One branch's outcome. `ok: false` is a dead branch — it errored, timed out, or
 * failed schema validation — and is excluded from every reduction (the analogue
 * of Claude's `.filter(Boolean)`).
 */
export interface BranchResult {
  branchId: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Surviving (non-dead) branches. */
export function survivors(results: BranchResult[]): BranchResult[] {
  return results.filter((r) => r.ok && r.data !== undefined);
}

/* ── Branch output schema (generalizes the evidence-gate `requires` check) ── */

export interface BranchSchema {
  /** Keys that must be present with a non-empty value. */
  requires: string[];
}

export interface SchemaCheck {
  ok: boolean;
  missing: string[];
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validate a branch's structured data against its stage's schema. A branch that
 * fails is dropped to a dead branch by `applySchema` so it can't corrupt a vote
 * or dedup.
 */
export function validateBranchData(
  data: Record<string, unknown> | undefined,
  schema: BranchSchema,
): SchemaCheck {
  if (!data) return { ok: false, missing: [...schema.requires] };
  const missing = schema.requires.filter((key) => isEmpty(data[key]));
  return { ok: missing.length === 0, missing };
}

/** Re-tag schema-invalid branches as dead so reducers never see them. */
export function applySchema(
  results: BranchResult[],
  schema: BranchSchema,
): BranchResult[] {
  return results.map((r) => {
    if (!r.ok) return r;
    const check = validateBranchData(r.data, schema);
    if (check.ok) return r;
    return {
      branchId: r.branchId,
      ok: false,
      error: `schema: missing ${check.missing.join(", ")}`,
    };
  });
}

/* ── Quorum ─────────────────────────────────────────────────────────────── */

export type FanoutKind = "discovery" | "verdict";

/**
 * Minimum surviving branches for a stage to produce a result. Discovery stages
 * tolerate losses (more finders is bonus coverage) and default to 1; verdict
 * stages need a meaningful sample and default to a majority of the launched
 * branches. An explicit positive `override` wins.
 */
export function quorumFloor(
  kind: FanoutKind,
  total: number,
  override?: number,
): number {
  if (override && override > 0) return override;
  // A stage with no launched branches can never produce a result: require at
  // least one survivor so an empty/all-dead wave fails quorum rather than
  // passing vacuously.
  if (total === 0) return 1;
  return kind === "verdict" ? Math.ceil(total / 2) : 1;
}

export function meetsQuorum(
  results: BranchResult[],
  kind: FanoutKind,
  override?: number,
): boolean {
  const live = survivors(results).length;
  // Always require at least one survivor, independent of the floor.
  return live >= 1 && live >= quorumFloor(kind, results.length, override);
}

/* ── Vote rule (verdict stages) ─────────────────────────────────────────── */

export type VoteThreshold = "majority" | "supermajority" | "unanimous";

export interface VoteSpec {
  /** Boolean field on each branch's data that means "this branch affirms". */
  field: string;
  threshold: VoteThreshold;
}

export interface VoteTally {
  affirm: number;
  surviving: number;
  passed: boolean;
}

/**
 * Tally a verdict panel with a rejection bias: only a survivor whose `field` is
 * exactly boolean `true` counts as affirming. Missing, falsey, or non-boolean
 * values count as rejection ("refute when unsure"). Ties reject.
 */
export function tallyVote(results: BranchResult[], spec: VoteSpec): VoteTally {
  const live = survivors(results);
  const affirm = live.filter((r) => r.data?.[spec.field] === true).length;
  const surviving = live.length;
  return {
    affirm,
    surviving,
    passed: votePasses(affirm, surviving, spec.threshold),
  };
}

function votePasses(
  affirm: number,
  surviving: number,
  threshold: VoteThreshold,
): boolean {
  if (surviving === 0) return false;
  switch (threshold) {
    case "unanimous":
      return affirm === surviving;
    case "supermajority":
      // >= two-thirds affirm.
      return affirm * 3 >= surviving * 2;
    default:
      // Strict majority; a tie rejects.
      return affirm * 2 > surviving;
  }
}

/* ── Item reducers (discovery / finder-pool stages) ─────────────────────── */

function itemsOf(
  result: BranchResult,
  itemsField: string,
): Record<string, unknown>[] {
  const raw = result.data?.[itemsField];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

/** Concatenate every surviving branch's `itemsField` array, order-preserving. */
export function concatItems(
  results: BranchResult[],
  itemsField: string,
): Record<string, unknown>[] {
  return survivors(results).flatMap((r) => itemsOf(r, itemsField));
}

/**
 * Concatenate then dedup items by `keyField`, keeping first occurrence. Items
 * missing the key are kept (treated as distinct). This backs loop-until-dry
 * convergence and pre-verify dedup.
 */
export function dedupByKey(
  results: BranchResult[],
  itemsField: string,
  keyField: string,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const item of concatItems(results, itemsField)) {
    const key = item[keyField];
    if (key === undefined || key === null) {
      out.push(item);
      continue;
    }
    // Type-tag so distinct values that stringify alike (1 vs "1", true vs
    // "true") are not collapsed into one key.
    const k = `${typeof key}:${String(key)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Count deduped items — for count-threshold gating. */
export function countThreshold(
  results: BranchResult[],
  itemsField: string,
  keyField: string,
  min: number,
): boolean {
  return dedupByKey(results, itemsField, keyField).length >= min;
}

/* ── Fan-out stage spec + reduction dispatcher ──────────────────────────── */

export type JoinKind =
  | "majority-vote"
  | "dedup-by-key"
  | "count-threshold"
  | "concat"
  | "synthesize";

/**
 * A declarative fan-out stage: the architect emits these in a preset's topology.
 * `branches`/`role` describes a K-identical panel; `roles` describes an N-distinct
 * (multi-lens) panel. `join` selects the deterministic reducer (or `synthesize`,
 * which defers the merge to a synthesizer role). `onPass`/`onFail` are the
 * routing events the stage emits after reduction.
 */
export interface FanoutStage {
  id: string;
  kind: FanoutKind;
  branches: number;
  role: string;
  roles: string[];
  join: JoinKind;
  requires: string[];
  voteField: string;
  voteThreshold: VoteThreshold;
  itemsField: string;
  keyField: string;
  countMin: number;
  quorum: number;
  onPass: string;
  onFail: string;
  synthesizerRole: string;
}

export interface StageOutcome {
  /** The routing event the stage emits. */
  event: string;
  passed: boolean;
  reason: string;
  /** Reduced items, for discovery joins (dedup/concat/count). */
  items?: Record<string, unknown>[];
  tally?: VoteTally;
}

/**
 * Reduce a fan-out stage's branch results into a single routing decision. Pure:
 * applies the branch schema, checks quorum, then runs the stage's join. The
 * `synthesize` join defers to a synthesizer role, so it passes through to
 * `onPass` carrying the surviving branches for that role to merge.
 */
export function reduceStage(
  stage: FanoutStage,
  results: BranchResult[],
): StageOutcome {
  const checked =
    stage.requires.length > 0
      ? applySchema(results, { requires: stage.requires })
      : results;

  if (!meetsQuorum(checked, stage.kind, stage.quorum || undefined)) {
    return {
      event: stage.onFail,
      passed: false,
      reason: `quorum not met (${survivors(checked).length}/${results.length} survived)`,
    };
  }

  switch (stage.join) {
    case "majority-vote": {
      const tally = tallyVote(checked, {
        field: stage.voteField,
        threshold: stage.voteThreshold,
      });
      return {
        event: tally.passed ? stage.onPass : stage.onFail,
        passed: tally.passed,
        reason: `${tally.affirm}/${tally.surviving} affirm (${stage.voteThreshold})`,
        tally,
      };
    }
    case "count-threshold": {
      const items = dedupByKey(checked, stage.itemsField, stage.keyField);
      const passed = items.length >= stage.countMin;
      return {
        event: passed ? stage.onPass : stage.onFail,
        passed,
        reason: `${items.length} unique (need ${stage.countMin})`,
        items,
      };
    }
    case "dedup-by-key": {
      const items = dedupByKey(checked, stage.itemsField, stage.keyField);
      return {
        event: stage.onPass,
        passed: true,
        reason: `${items.length} unique items`,
        items,
      };
    }
    case "concat": {
      const items = concatItems(checked, stage.itemsField);
      return {
        event: stage.onPass,
        passed: true,
        reason: `${items.length} items`,
        items,
      };
    }
    default: {
      // synthesize: a synthesizer role performs the semantic merge; the stage
      // passes through carrying the surviving items.
      return {
        event: stage.onPass,
        passed: true,
        reason: "defer to synthesizer role",
        items: concatItems(checked, stage.itemsField),
      };
    }
  }
}
