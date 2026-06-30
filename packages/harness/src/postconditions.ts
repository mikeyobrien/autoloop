import { dirname, relative, sep } from "node:path";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
} from "@mobrienv/autoloop-core/journal";
import {
  type AddedLine,
  collectAddedLines,
  isGitRepo,
  porcelainStatus,
} from "./git-diff.js";
import type { LoopContext } from "./types.js";

export interface PostconditionViolation {
  /** Stable assertion id, e.g. "no_todo". */
  id: string;
  /** Human-readable detail (sample offending lines / files). */
  detail: string;
}

export interface PostconditionResult {
  /** True when at least one guard was enabled and evaluated. */
  ran: boolean;
  /** True when no enabled guard was violated. */
  passed: boolean;
  violations: PostconditionViolation[];
}

const MAX_SAMPLE = 10;

const TODO_RE = /\b(TODO|FIXME|XXX|HACK)\b/;
const SKIP_RE =
  /(\b(it|describe|test)\.(only|skip)\b|\bx(it|describe)\b|\bf(it|describe)\b|@pytest\.mark\.(skip|xfail)|\bunittest\.skip\b|#\[ignore\]|\bdescribe\.only\b)/;
const SECRET_RES: Array<[string, RegExp]> = [
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["slack-token", /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ["github-token", /\bghp_[0-9A-Za-z]{36}\b/],
  [
    "generic-secret",
    /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/i,
  ],
];

function sample(lines: AddedLine[]): string {
  return lines
    .slice(0, MAX_SAMPLE)
    .map((l) => `  ${l.file}: ${l.text.trim()}`)
    .join("\n");
}

/**
 * Evaluate the enabled required-absence guards at the acceptance gate. All are
 * harness-side and independent of agent claims; a violation blocks completion.
 * Guards that depend on git are skipped (not failed) outside a git work tree.
 */
export function runPostconditionGuards(
  loop: LoopContext,
  iteration: number,
): PostconditionResult {
  const a = loop.acceptance;
  const enabled =
    a.assertNoTodo ||
    a.assertNoSkippedTests ||
    a.assertNoSecrets ||
    a.assertCleanTree;
  if (!enabled) return { ran: false, passed: true, violations: [] };

  const iter = String(iteration);
  const workDir = loop.paths.workDir;
  const inRepo = isGitRepo(workDir);
  const violations: PostconditionViolation[] = [];

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "postcondition.start",
    jsonFieldRaw("git_repo", jsonBool(inRepo)),
  );

  if (
    inRepo &&
    (a.assertNoTodo || a.assertNoSkippedTests || a.assertNoSecrets)
  ) {
    const added = collectAddedLines(workDir);
    if (a.assertNoTodo) {
      const hits = added.filter((l) => TODO_RE.test(l.text));
      if (hits.length)
        violations.push({
          id: "no_todo",
          detail: `New TODO/FIXME/XXX/HACK markers:\n${sample(hits)}`,
        });
    }
    if (a.assertNoSkippedTests) {
      const hits = added.filter((l) => SKIP_RE.test(l.text));
      if (hits.length)
        violations.push({
          id: "no_skipped_tests",
          detail: `Skipped/only/xfail test markers:\n${sample(hits)}`,
        });
    }
    if (a.assertNoSecrets) {
      const hits = added.filter((l) =>
        SECRET_RES.some(([, re]) => re.test(l.text)),
      );
      if (hits.length)
        violations.push({
          id: "no_secrets",
          detail: `Possible committed secrets:\n${sample(hits)}`,
        });
    }
  }

  if (a.assertCleanTree && inRepo) {
    // The harness writes its own journal/state during this very guard, so a
    // tracked `.autoloop/` would make the guard trip on its own bookkeeping.
    // clean_tree asserts the agent left the *project* clean — exclude the
    // autoloop state dir from the assessment.
    const stateRel = relative(workDir, dirname(loop.paths.journalFile));
    const dirty = porcelainStatus(workDir).filter((line) => {
      if (!stateRel || stateRel.startsWith("..")) return true;
      const path = line.slice(3); // strip the `XY ` porcelain status prefix
      return path !== stateRel && !path.startsWith(`${stateRel}${sep}`);
    });
    if (dirty.length)
      violations.push({
        id: "clean_tree",
        detail: `Working tree is not clean:\n${dirty.slice(0, MAX_SAMPLE).join("\n")}`,
      });
  }

  const passed = violations.length === 0;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "postcondition.result",
    jsonFieldRaw("passed", jsonBool(passed)) +
      ", " +
      jsonField("violations", violations.map((v) => v.id).join(",")),
  );

  return { ran: true, passed, violations };
}

/**
 * Re-inject violated postconditions as operator guidance so the next iteration
 * fixes them instead of completing.
 */
export function reinjectPostconditionFailure(
  loop: LoopContext,
  iteration: number,
  result: PostconditionResult,
): void {
  const detail = result.violations
    .map((v) => `- [${v.id}] ${v.detail}`)
    .join("\n\n");
  const message =
    "Completion was blocked: required-absence guards failed. " +
    "Remove these before claiming completion.\n\n" +
    detail;
  appendOperatorEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance",
    message,
  );
}
