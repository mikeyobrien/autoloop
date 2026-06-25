import { jsonBool, jsonField, jsonFieldRaw } from "../json.js";
import type { JournalEvent } from "./types.js";

/**
 * Schema version of the journal JSONL contract. Every encoded line carries a
 * top-level `"v"` field set to this value so an external consumer (e.g. a tailer
 * driving autoloop as a subprocess) can detect a breaking change to the record
 * shape. Bump this whenever the on-disk record shape changes incompatibly.
 *
 * ## Journal contract (v1)
 *
 * Each line is one complete, newline-terminated JSON object. `appendEvent`
 * writes exactly one line per `appendFileSync`, so a reader that consumes only
 * newline-terminated lines never observes a torn record. Every line carries:
 *
 * - `"v"`: this contract version (number).
 * - `"ts"`: ISO-8601 timestamp (millisecond precision) at append time.
 * - `"run"`: the run id.
 * - `"topic"`: the event topic.
 * - `"iteration"`: the iteration index as a string, when applicable.
 * - then either `"fields"` (an object map) or `"payload"`+`"source"`.
 *
 * Field order is not part of the contract; consumers must parse by key.
 */
export const JOURNAL_CONTRACT_VERSION = 1;

/** Default wall-clock source; overridable in `encodeEvent` for deterministic tests. */
function defaultNow(): string {
  return new Date().toISOString();
}

export function encodeEvent(
  event: JournalEvent,
  now: () => string = defaultNow,
): string {
  const base = [jsonField("run", event.run)];
  if (event.iteration) base.push(jsonField("iteration", event.iteration));
  base.push(jsonField("topic", String(event.topic)));
  // Versioned, timestamped contract fields (see JOURNAL_CONTRACT_VERSION).
  base.push(jsonField("ts", now()));
  base.push(jsonFieldRaw("v", String(JOURNAL_CONTRACT_VERSION)));

  if (event.shape === "payload") {
    base.push(jsonField("payload", event.payload));
    if (event.source) base.push(jsonField("source", event.source));
    return `{${base.join(", ")}}\n`;
  }

  return (
    "{" +
    base.join(", ") +
    ', "fields": {' +
    encodeFields(event.rawFields ?? event.fields) +
    "}}\n"
  );
}

function encodeFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => encodeField(key, value))
    .join(", ");
}

function encodeField(key: string, value: unknown): string {
  if (typeof value === "boolean") return jsonFieldRaw(key, jsonBool(value));
  if (typeof value === "number") return jsonFieldRaw(key, String(value));
  if (value === null) return jsonFieldRaw(key, "null");
  return jsonField(key, String(value ?? ""));
}
