import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { discoverChainStepStateLayouts } from "./chain-state.js";
import { decodeEvent } from "./events/decode.js";
import { encodeEvent } from "./events/encode.js";
import {
  extractField as jsonExtractField,
  extractTopic as jsonExtractTopic,
} from "./json.js";
import { lineSep } from "./utils.js";

export function appendEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  fieldsJson: string,
): void {
  appendText(
    path,
    encodeEvent({
      shape: "fields",
      run: runId,
      iteration: iteration || undefined,
      topic,
      fields: parsedFields(fieldsJson),
      rawFields: parsedFieldsRaw(fieldsJson),
    }),
  );
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

export function appendOperatorEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
): void {
  appendEmittedEvent(path, runId, iteration, topic, payload, "operator");
}

function appendEmittedEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
  source: string,
): void {
  appendText(
    path,
    encodeEvent({
      shape: "payload",
      run: runId,
      iteration: iteration || undefined,
      topic,
      payload,
      source,
    }),
  );
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
    return JSON.parse(`{${fieldsJson}}`) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * A line is a well-formed journal record iff it parses as a JSON object (the
 * journal contract). A torn write (crash mid-append) yields invalid JSON, so
 * this is the integrity check used to quarantine corruption on read.
 */
export function isValidJournalLine(line: string): boolean {
  return decodeEvent(line) !== null;
}

/**
 * Validate-on-read: malformed/torn lines (e.g. a partial last record after a
 * `kill -9`) are skipped rather than allowed to poison consumers. This keeps a
 * corrupt journal non-fatal; `quarantineJournal` physically sets the bad lines
 * aside for recovery.
 */
export function readLines(path: string): string[] {
  const text = readIfExists(path);
  return text
    .split(lineSep())
    .map((l) => l.trim())
    .filter((l) => l !== "" && isValidJournalLine(l));
}

export function readRunLines(path: string, runId: string): string[] {
  return readLines(path).filter((line) => extractRun(line) === runId);
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

export function latestIterationForRun(path: string, runId: string): string {
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

function appendJournal(
  allLines: string[],
  seenPaths: Set<string>,
  path: string,
): void {
  if (!existsSync(path)) return;
  const canonicalPath = realpathSync(path);
  if (seenPaths.has(canonicalPath)) return;
  seenPaths.add(canonicalPath);
  allLines.push(...readLines(path));
}

function appendStateJournals(
  allLines: string[],
  seenPaths: Set<string>,
  baseStateDir: string,
  stateDirRel: string,
): void {
  appendJournal(allLines, seenPaths, join(baseStateDir, "journal.jsonl"));

  const runsDir = join(baseStateDir, "runs");
  if (existsSync(runsDir)) {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const runJournal = join(runsDir, entry.name, "journal.jsonl");
      appendJournal(allLines, seenPaths, runJournal);
    }
  }

  for (const entry of readdirDirs(join(baseStateDir, "worktrees"))) {
    const treeDir = join(baseStateDir, "worktrees", entry, "tree");
    const wtStateDir = isAbsolute(stateDirRel)
      ? stateDirRel
      : join(treeDir, stateDirRel);
    const wtJournal = join(wtStateDir, "journal.jsonl");
    appendJournal(allLines, seenPaths, wtJournal);
  }
}

function readdirDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Merge journals from the top-level state, its isolated runs, and bounded chain
 * step roots. Chain children use recorded state layouts with legacy fallbacks.
 */
export function readAllJournals(
  baseStateDir: string,
  stateDirRel: string = basename(baseStateDir),
): string[] {
  const allLines: string[] = [];
  const seenPaths = new Set<string>();
  appendStateJournals(allLines, seenPaths, baseStateDir, stateDirRel);

  for (const layout of discoverChainStepStateLayouts(
    baseStateDir,
    stateDirRel,
  )) {
    appendStateJournals(
      allLines,
      seenPaths,
      layout.stateDir,
      layout.stateDirRel,
    );
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
export function resolveRunJournalPath(
  baseStateDir: string,
  runId: string,
  stateDirRel: string = basename(baseStateDir),
): string | null {
  const runJournal = join(baseStateDir, "runs", runId, "journal.jsonl");
  if (existsSync(runJournal)) return runJournal;

  const wtJournal = join(
    baseStateDir,
    "worktrees",
    runId,
    "tree",
    stateDirRel,
    "journal.jsonl",
  );
  if (existsSync(wtJournal)) return wtJournal;

  return null;
}

/**
 * Read journal lines for a specific run.
 * Checks run-scoped and worktree paths via resolveRunJournalPath.
 */
export function readRunJournal(
  baseStateDir: string,
  runId: string,
  stateDirRel?: string,
): string[] {
  const path = resolveRunJournalPath(baseStateDir, runId, stateDirRel);
  return path ? readLines(path) : [];
}

function extractTimestamp(line: string): string {
  return extractField(line, "timestamp") || extractField(line, "ts") || "";
}

/**
 * Durable append: write the record and fsync it to disk before returning, so a
 * crash immediately after the call cannot lose an acknowledged record. Each
 * `appendEvent` writes exactly one newline-terminated line; fsync makes that
 * line durable. fsync is best-effort — some filesystems reject it on a regular
 * file fd, in which case the write has still landed in the page cache.
 */
export function appendText(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, content);
    try {
      fsyncSync(fd);
    } catch {
      /* fsync unsupported on this fd/FS; the write itself still succeeded */
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomically replace a file's contents: write a sibling temp file, fsync it,
 * then rename over the target (rename is atomic on POSIX). A crash leaves
 * either the old file or the new one, never a half-written target.
 */
export function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, content);
    try {
      fsyncSync(fd);
    } catch {
      /* best-effort durability */
    }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Move torn/malformed lines out of the journal into `<path>.quarantine` and
 * atomically rewrite the journal with only the valid records. Idempotent: a
 * clean journal is left untouched (no rewrite, no quarantine file). Returns the
 * number of quarantined lines. Use at run start and from `doctor --repair` so a
 * poisoned journal self-heals instead of wedging the run.
 */
export function quarantineJournal(path: string): { quarantined: number } {
  if (!existsSync(path)) return { quarantined: 0 };
  const lines = readIfExists(path).split(lineSep());
  const valid: string[] = [];
  const corrupt: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (isValidJournalLine(line)) valid.push(line);
    else corrupt.push(line);
  }
  if (corrupt.length === 0) return { quarantined: 0 };
  appendText(`${path}.quarantine`, `${corrupt.join("\n")}\n`);
  atomicWriteFile(path, valid.length ? `${valid.join("\n")}\n` : "");
  return { quarantined: corrupt.length };
}

export function readIfExists(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}
