import { existsSync, readFileSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { extractField as jsonExtractField, extractTopic as jsonExtractTopic } from "../json.js";
import { encodeEvent } from "../events/encode.js";
import { lineSep, shellQuote } from "../utils.js";

export function appendEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  fieldsJson: string,
): void {
  appendText(path, encodeEvent({
    shape: "fields",
    run: runId,
    iteration: iteration || undefined,
    topic,
    fields: parsedFields(fieldsJson),
    rawFields: parsedFieldsRaw(fieldsJson),
  }));
}

export function appendAgentEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
): void {
  appendEmittedEvent(path, runId, iteration, topic, payload, "agent");
}

export function appendHarnessEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
): void {
  appendEmittedEvent(path, runId, iteration, topic, payload, "harness");
}

function appendEmittedEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
  source: string,
): void {
  appendText(path, encodeEvent({
    shape: "payload",
    run: runId,
    iteration: iteration || undefined,
    topic,
    payload,
    source,
  }));
}

function parsedFields(fieldsJson: string): Record<string, string> {
  const parsed = parsedFieldsRaw(fieldsJson);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = String(value ?? "");
  }
  return result;
}

function parsedFieldsRaw(fieldsJson: string): Record<string, unknown> {
  if (!fieldsJson.trim()) return {};
  try {
    return JSON.parse("{" + fieldsJson + "}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readLines(path: string): string[] {
  const text = readIfExists(path);
  return text
    .split(lineSep())
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

export function readRunLines(path: string, runId: string): string[] {
  return readLines(path).filter(
    (line) => extractRun(line) === runId,
  );
}

export function extractTopic(line: string): string {
  return jsonExtractTopic(line);
}

export function extractField(line: string, key: string): string {
  return jsonExtractField(line, key);
}

export function extractRun(line: string): string {
  return extractField(line, "run");
}

export function extractIteration(line: string): string {
  return extractField(line, "iteration");
}

export function latestRunId(path: string): string {
  const lines = readLines(path);
  let current = "";
  for (const line of lines) {
    if (extractTopic(line) === "loop.start") {
      const run = extractRun(line);
      if (run) current = run;
    }
  }
  return current;
}

export function latestIterationForRun(
  path: string,
  runId: string,
): string {
  const lines = readRunLines(path, runId);
  let current = "";
  for (const line of lines) {
    if (extractTopic(line) === "iteration.start") {
      const iter = extractIteration(line);
      if (iter) current = iter;
    }
  }
  return current;
}

/**
 * Merge journals from the top-level file, per-run journals under runs/,
 * and worktree journals under worktrees/<id>/tree/<stateDirName>/.
 * Returns all lines sorted by timestamp.
 */
export function readAllJournals(baseStateDir: string): string[] {
  const allLines: string[] = [];

  // Top-level journal
  const topLevel = join(baseStateDir, "journal.jsonl");
  if (existsSync(topLevel)) allLines.push(...readLines(topLevel));

  // Per-run journals under runs/*/journal.jsonl
  const runsDir = join(baseStateDir, "runs");
  if (existsSync(runsDir)) {
    const entries = readdirSync(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runJournal = join(runsDir, entry.name, "journal.jsonl");
      if (existsSync(runJournal)) allLines.push(...readLines(runJournal));
    }
  }

  // Worktree journals under worktrees/<id>/tree/<stateDirName>/journal.jsonl
  const stateDirName = basename(baseStateDir);
  const wtDir = join(baseStateDir, "worktrees");
  if (existsSync(wtDir)) {
    const entries = readdirSync(wtDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wtJournal = join(wtDir, entry.name, "tree", stateDirName, "journal.jsonl");
      if (existsSync(wtJournal)) allLines.push(...readLines(wtJournal));
    }
  }

  // Sort by timestamp field if present
  return allLines.sort((a, b) => {
    const tsA = extractTimestamp(a);
    const tsB = extractTimestamp(b);
    return tsA.localeCompare(tsB);
  });
}

/**
 * Resolve the journal file path for a specific run within a state directory.
 * Checks run-scoped (runs/<runId>/journal.jsonl) and worktree paths first.
 * Returns null if no run-specific journal exists.
 */
export function resolveRunJournalPath(baseStateDir: string, runId: string): string | null {
  const runJournal = join(baseStateDir, "runs", runId, "journal.jsonl");
  if (existsSync(runJournal)) return runJournal;

  const stateDirName = basename(baseStateDir);
  const wtJournal = join(baseStateDir, "worktrees", runId, "tree", stateDirName, "journal.jsonl");
  if (existsSync(wtJournal)) return wtJournal;

  return null;
}

/**
 * Read journal lines for a specific run.
 * Checks run-scoped and worktree paths via resolveRunJournalPath.
 */
export function readRunJournal(baseStateDir: string, runId: string): string[] {
  const path = resolveRunJournalPath(baseStateDir, runId);
  return path ? readLines(path) : [];
}

function extractTimestamp(line: string): string {
  return extractField(line, "timestamp") || extractField(line, "ts") || "";
}

export function appendText(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, content, "utf-8");
}

export function readIfExists(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}
