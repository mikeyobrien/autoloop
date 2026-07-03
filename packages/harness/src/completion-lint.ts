import { parseCriterion } from "./intent.js";

export interface CompletionContractInput {
  /** Completion promise string (stdout fallback). */
  promise: string;
  /** Completion event topic. */
  event: string;
  /** Required-evidence events that must precede completion. */
  requiredEvents: string[];
  /** Out-of-band acceptance verify commands. */
  verifyCmds: string[];
  /** Intent-binding acceptance criteria (may bind `text :: cmd` checks). */
  criteria: string[];
}

export interface ContractLintFinding {
  level: "warn" | "info";
  rule: string;
  message: string;
}

// Trivial promise strings an agent can satisfy incidentally.
const TRIVIAL_PROMISE =
  /^(done|ok|okay|complete|completed|finished|yes|true|success)$/i;

/**
 * Does the contract have ANY deterministic, harness-checkable completion
 * condition (verify command, required event, or a criterion-bound check)? If
 * not, completion is self-asserted with nothing to falsify it.
 */
export function hasDeterministicCheck(c: CompletionContractInput): boolean {
  if (c.verifyCmds.length > 0) return true;
  if (c.requiredEvents.length > 0) return true;
  return c.criteria.some((line) => parseCriterion(line).check !== undefined);
}

/**
 * Lint a completion contract for falsifiability and triviality BEFORE a run
 * burns iterations on a bad stop condition. Returns [] for a well-formed
 * contract; warnings for trivial/un-falsifiable ones.
 */
export function lintCompletionContract(
  c: CompletionContractInput,
): ContractLintFinding[] {
  const findings: ContractLintFinding[] = [];
  const deterministic = hasDeterministicCheck(c);

  if (!deterministic) {
    findings.push({
      level: "warn",
      rule: "unfalsifiable_completion",
      message:
        "Completion has no deterministic check — the agent can satisfy it without proof. Add acceptance.verify_cmds, event_loop.required_events, or a criterion-bound check (`text :: cmd`).",
    });
  }

  // A trivial promise is only a real hazard when nothing else gates completion
  // (otherwise the deterministic check backs it up).
  if (c.promise && !deterministic && TRIVIAL_PROMISE.test(c.promise.trim())) {
    findings.push({
      level: "warn",
      rule: "trivial_promise",
      message: `Completion promise "${c.promise}" is trivially printable; the agent can emit it without doing the work. Use a distinctive promise plus a deterministic check.`,
    });
  }

  // Criteria present but all advisory — they won't gate completion.
  if (
    c.criteria.length > 0 &&
    !c.criteria.some((line) => parseCriterion(line).check !== undefined)
  ) {
    findings.push({
      level: "info",
      rule: "advisory_criteria_only",
      message:
        "Acceptance criteria are advisory only (no `::` checks); they are recorded but do not gate completion. Bind a check to enforce them.",
    });
  }

  return findings;
}
