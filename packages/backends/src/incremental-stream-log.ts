import { appendFileSync, writeFileSync } from "node:fs";

const STREAM_FLUSH_BYTES = 64 * 1024;
const STREAM_FLUSH_INTERVAL_MS = 250;

export interface IncrementalStreamLog {
  /** Complete JSONL records waiting to be persisted. */
  streamLines: string[];
  /** UTF-8 bytes represented by streamLines, including their trailing LFs. */
  streamBufferedBytes: number;
  /** Whether this prompt has successfully created its stream log. */
  streamLogStarted: boolean;
  /** Wall-clock time of the last flush attempt. */
  streamLastFlushAt: number;
  streamLogPath?: string;
}

/** Start a prompt with an empty buffer whose first flush truncates the log. */
export function resetStreamLog(log: IncrementalStreamLog): void {
  log.streamLines = [];
  log.streamBufferedBytes = 0;
  log.streamLogStarted = false;
  log.streamLastFlushAt = Date.now();
}

/** Buffer one complete record and flush when the size or latency bound is hit. */
export function pushStreamLogLine(
  log: IncrementalStreamLog,
  line: string,
): void {
  log.streamLines.push(line);
  log.streamBufferedBytes += Buffer.byteLength(line, "utf-8") + 1;

  const now = Date.now();
  if (
    log.streamBufferedBytes >= STREAM_FLUSH_BYTES ||
    now - log.streamLastFlushAt >= STREAM_FLUSH_INTERVAL_MS
  ) {
    flushStreamLog(log, now);
  }
}

/** Persist the buffered tail. Every write ends at a complete JSONL record. */
export function flushStreamLog(
  log: IncrementalStreamLog,
  now = Date.now(),
): void {
  const path = log.streamLogPath;
  if (!path || log.streamLines.length === 0) return;

  const contents = `${log.streamLines.join("\n")}\n`;
  try {
    if (log.streamLogStarted) appendFileSync(path, contents, "utf-8");
    else writeFileSync(path, contents, "utf-8");
    log.streamLogStarted = true;
  } catch {
    /* logging must never fail the iteration */
  }

  log.streamLines = [];
  log.streamBufferedBytes = 0;
  log.streamLastFlushAt = now;
}
