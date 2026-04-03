import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { jsonField, jsonFieldRaw, jsonBool, extractField as jsonExtractField, extractTopic as jsonExtractTopic } from "../json.js";
import { lineSep, shellQuote } from "../utils.js";

export function appendEvent(
  path: string,
  runId: string,
  iteration: string,
  topic: string,
  fieldsJson: string,
): void {
  appendText(path, eventLine(runId, iteration, topic, fieldsJson));
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
  appendText(path, emittedEventLine(runId, iteration, topic, payload, source));
}

function eventLine(
  runId: string,
  iteration: string,
  topic: string,
  fieldsJson: string,
): string {
  return (
    "{" +
    recordPrefix(runId, iteration) +
    jsonField("topic", topic) +
    ', "fields": {' +
    fieldsJson +
    "}}\n"
  );
}

function emittedEventLine(
  runId: string,
  iteration: string,
  topic: string,
  payload: string,
  source: string,
): string {
  return (
    "{" +
    recordPrefix(runId, iteration) +
    jsonField("topic", topic) +
    ", " +
    jsonField("payload", payload) +
    ", " +
    jsonField("source", source) +
    "}\n"
  );
}

function recordPrefix(runId: string, iteration: string): string {
  if (!iteration) return jsonField("run", runId) + ", ";
  return (
    jsonField("run", runId) +
    ", " +
    jsonField("iteration", iteration) +
    ", "
  );
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

export function appendText(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, content, "utf-8");
}

export function readIfExists(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}
