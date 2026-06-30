import { spawnSync } from "node:child_process";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
} from "@mobrienv/autoloop-core/journal";
import type { LoopContext } from "./types.js";

export interface AcceptanceCriterion {
  /** The stated criterion text (intent). */
  text: string;
  /** Optional deterministic shell check bound to the criterion. */
  check?: string;
}

export interface IntentResult {
  /** True when at least one checkable criterion was evaluated. */
  ran: boolean;
  /** True when every checkable criterion passed. */
  passed: boolean;
  failures: Array<{
    text: string;
    check: string;
    exitCode: number;
    tail: string;
  }>;
}

const CHECK_SEP = " :: ";

/** Parse one criterion line into text + optional bound check. */
export function parseCriterion(line: string): AcceptanceCriterion {
  const idx = line.indexOf(CHECK_SEP);
  if (idx === -1) return { text: line.trim() };
  return {
    text: line.slice(0, idx).trim(),
    check: line.slice(idx + CHECK_SEP.length).trim() || undefined,
  };
}

/**
 * Extract acceptance criteria from an objective's "Acceptance criteria" (or
 * "Acceptance Criteria") section: the bullet/numbered lines following the
 * heading, up to the next blank line or heading. Returns [] when absent.
 */
export function parseObjectiveCriteria(objective: string): string[] {
  const lines = objective.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{0,6}\s*acceptance\s+criteria\b/i.test(line.replace(/[:*_]/g, ""))) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line === "") break;
    // A new markdown heading ends the section.
    if (/^#{1,6}\s/.test(line)) break;
    const bullet = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) out.push(bullet[1].trim());
    else break; // non-bullet line ends a bullet list
  }
  return out;
}

/**
 * Capture the intent-binding contract at loop start: config criteria first,
 * then any parsed from the objective (deduped by text). This is the bound
 * record of "what was asked" the deterministic gate keys off.
 */
export function captureAcceptanceContract(
  loop: LoopContext,
): AcceptanceCriterion[] {
  const raw = [
    ...(loop.acceptance.criteria ?? []),
    ...parseObjectiveCriteria(loop.objective ?? ""),
  ];
  const seen = new Set<string>();
  const criteria: AcceptanceCriterion[] = [];
  for (const line of raw) {
    const c = parseCriterion(line);
    if (!c.text || seen.has(c.text)) continue;
    seen.add(c.text);
    criteria.push(c);
  }
  return criteria;
}

/** Journal the bound acceptance contract once at loop start (audit/durability). */
export function journalAcceptanceContract(loop: LoopContext): void {
  const criteria = captureAcceptanceContract(loop);
  if (criteria.length === 0) return;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "acceptance.contract",
    jsonField("count", String(criteria.length)) +
      ", " +
      jsonField("criteria", criteria.map((c) => c.text).join(" | ")) +
      ", " +
      jsonFieldRaw("checked", String(criteria.filter((c) => c.check).length)),
  );
}

/**
 * Evaluate the intent-binding criteria at the acceptance gate. Criteria that
 * bind a deterministic check (`text :: cmd`) are run HARNESS-side in the work
 * dir; a non-zero exit fails acceptance so a run that passes its tests but does
 * not satisfy the stated intent is still rejected. Criteria without a check are
 * advisory (recorded in the contract, not a hard blocker).
 */
export function runIntentCriteria(
  loop: LoopContext,
  iteration: number,
): IntentResult {
  const checked = captureAcceptanceContract(loop).filter((c) => c.check);
  if (checked.length === 0) return { ran: false, passed: true, failures: [] };

  const iter = String(iteration);
  const failures: IntentResult["failures"] = [];
  for (const c of checked) {
    const check = c.check as string;
    const res = spawnSync(check, {
      shell: "/bin/sh",
      cwd: loop.paths.workDir,
      encoding: "utf-8",
      timeout: loop.acceptance.timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    const timedOut =
      res.signal === "SIGTERM" ||
      (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    const exitCode = timedOut ? 124 : (res.status ?? 1);
    const tail = `${res.stdout ?? ""}${res.stderr ?? ""}`.slice(-1000);
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      iter,
      "acceptance.criterion",
      jsonField("text", c.text) +
        ", " +
        jsonField("check", check) +
        ", " +
        jsonField("exit_code", String(exitCode)),
    );
    if (exitCode !== 0) failures.push({ text: c.text, check, exitCode, tail });
  }

  const passed = failures.length === 0;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "acceptance.intent_result",
    jsonFieldRaw("passed", jsonBool(passed)) +
      ", " +
      jsonField("failed", String(failures.length)),
  );
  return { ran: true, passed, failures };
}

/** Re-inject failed intent criteria as operator guidance. */
export function reinjectIntentFailure(
  loop: LoopContext,
  iteration: number,
  result: IntentResult,
): void {
  const detail = result.failures
    .map(
      (f) =>
        `- "${f.text}" (check \`${f.check}\` exited ${f.exitCode}):\n${f.tail}`,
    )
    .join("\n\n");
  const message =
    "Completion was blocked: the build does not satisfy the stated acceptance " +
    "criteria (intent-binding), even if tests pass. Satisfy these before " +
    `claiming completion:\n\n${detail}`;
  appendOperatorEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance",
    message,
  );
}
