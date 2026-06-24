// Structured NDJSON event sink — the machine-readable counterpart to the human
// cliPrintEvent renderer.
//
// `autoloop run --events <path>` writes every LoopEvent to `path` as one NDJSON
// line, in addition to the normal terminal rendering. This lets an external
// parent (e.g. ralph driving autoloop as a subprocess) consume a stable,
// structured event stream instead of scraping terminal text or tailing the
// internal journal. The terminal `progress` event (resolved routing + outcome)
// is only available on this stream, not in the journal.
//
// The final `loop.finish` / `summary` events carry the machine-readable run
// result (runId, iterations, stopReason), so a consumer gets the outcome from
// the stream without parsing the journal.

import { closeSync, openSync, writeSync } from "node:fs";
import type { LoopEvent } from "@mobrienv/autoloop-harness/events";

export interface EventSink {
  onEvent: (event: LoopEvent) => void;
  close: () => void;
}

/**
 * Append every LoopEvent to `path` as one NDJSON line. Writes are synchronous
 * and newline-framed (one `writeSync` per event) so a concurrent reader that
 * consumes only newline-terminated lines never observes a torn record. The sink
 * is best-effort: a write failure is swallowed so it can never crash the loop.
 */
export function ndjsonEventSink(path: string): EventSink {
  const fd = openSync(path, "a");
  return {
    onEvent(event: LoopEvent): void {
      try {
        writeSync(fd, `${JSON.stringify(event)}\n`);
      } catch {
        // Best-effort: never let the events sink crash the loop.
      }
    },
    close(): void {
      try {
        closeSync(fd);
      } catch {
        // Already closed / invalid fd — nothing to do.
      }
    },
  };
}

/** Compose two event emitters into one that invokes both, in order. */
export function teeEvents(
  first: (e: LoopEvent) => void,
  second: (e: LoopEvent) => void,
): (e: LoopEvent) => void {
  return (e: LoopEvent) => {
    first(e);
    second(e);
  };
}
