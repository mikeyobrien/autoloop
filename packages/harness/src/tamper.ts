import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import {
  appendEvent,
  appendOperatorEvent,
} from "@mobrienv/autoloop-core/journal";
import {
  type AddedLine,
  changedFiles,
  collectAddedLines,
  isGitRepo,
} from "./git-diff.js";
import type { LoopContext } from "./types.js";

export interface TamperViolation {
  id: string;
  detail: string;
}

export interface TamperResult {
  ran: boolean;
  passed: boolean;
  violations: TamperViolation[];
}

const MAX_SAMPLE = 10;

/** Heuristic test-file detector across common ecosystems. */
export function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)test_[^/]*\.py$/.test(path) ||
    /_test\.(py|go|rb)$/.test(path) ||
    /(^|\/)(tests?|__tests__|spec)\//.test(path) ||
    /Test\.(java|kt|cs)$/.test(path) ||
    /_spec\.rb$/.test(path)
  );
}

// Patterns that, when introduced on a test path, weaken or short-circuit the
// gating tests. Each is scoped to added lines inside test files.
const TAMPER_PATTERNS: Array<[string, RegExp]> = [
  [
    "test_skip_or_only",
    /(\b(it|describe|test)\.(only|skip)\b|\bx(it|describe)\b|\bf(it|describe)\b|@pytest\.mark\.(skip|xfail)|\bunittest\.skip\b|#\[ignore\])/,
  ],
  [
    "test_early_exit",
    /\b(process\.exit|os\._?exit|sys\.exit|System\.exit)\s*\(/,
  ],
  [
    "tautological_assert",
    /(expect\(\s*(true|1|"")\s*\)\s*\.\s*toBe(Truthy)?\(|assert\s+true\b|assertTrue\(\s*true\s*\)|assert\s+1\s*==\s*1\b|expect\(\s*true\s*\)\.toBeTruthy\()/i,
  ],
];

function sample(items: string[]): string {
  return items.slice(0, MAX_SAMPLE).join("\n");
}

/**
 * Anti-reward-hack tamper screen. With `screen_test_tamper` on, a test-backed
 * done-claim is blocked when the run touched gating tests or inserted
 * tamper patterns on test paths — harness-side and maker-uninfluenceable.
 * Returns `{ ran: false, passed: true }` when disabled or outside a git tree.
 */
export function runTamperScreen(
  loop: LoopContext,
  iteration: number,
): TamperResult {
  if (!loop.acceptance.screenTestTamper) {
    return { ran: false, passed: true, violations: [] };
  }
  const workDir = loop.paths.workDir;
  const iter = String(iteration);
  if (!isGitRepo(workDir)) {
    // No baseline to diff against — cannot screen deterministically.
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      iter,
      "tamper.result",
      jsonFieldRaw("passed", jsonBool(true)) +
        ", " +
        jsonField("skipped", "no_git"),
    );
    return { ran: true, passed: true, violations: [] };
  }

  const violations: TamperViolation[] = [];

  // 1. Deterministic: did the gating test files change this run?
  const touchedTests = changedFiles(workDir).filter(isTestFile);
  if (touchedTests.length) {
    violations.push({
      id: "test_files_changed",
      detail: `Test files were modified during the run that claims completion:\n${sample(touchedTests)}`,
    });
  }

  // 2. Tamper patterns inserted on test paths.
  const addedInTests: AddedLine[] = collectAddedLines(workDir).filter((l) =>
    isTestFile(l.file),
  );
  for (const [id, re] of TAMPER_PATTERNS) {
    const hits = addedInTests.filter((l) => re.test(l.text));
    if (hits.length)
      violations.push({
        id,
        detail: `${id} in test files:\n${sample(hits.map((l) => `  ${l.file}: ${l.text.trim()}`))}`,
      });
  }

  const passed = violations.length === 0;
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iter,
    "tamper.result",
    jsonFieldRaw("passed", jsonBool(passed)) +
      ", " +
      jsonField("violations", violations.map((v) => v.id).join(",")),
  );
  return { ran: true, passed, violations };
}

/** Re-inject a tamper-screen failure as operator guidance. */
export function reinjectTamperFailure(
  loop: LoopContext,
  iteration: number,
  result: TamperResult,
): void {
  const detail = result.violations
    .map((v) => `- [${v.id}] ${v.detail}`)
    .join("\n\n");
  const message =
    "Completion was blocked: the test-tamper screen detected that gating " +
    "tests were changed or weakened this run. Do not modify the tests that " +
    "verify the work; make the implementation pass the existing tests.\n\n" +
    detail;
  appendOperatorEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "operator.guidance",
    message,
  );
}
