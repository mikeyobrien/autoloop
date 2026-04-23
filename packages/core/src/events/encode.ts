import { jsonBool, jsonField, jsonFieldRaw } from "../json.js";
import type { JournalEvent } from "./types.js";

export function encodeEvent(event: JournalEvent): string {
  const base = [jsonField("run", event.run)];
  if (event.iteration) base.push(jsonField("iteration", event.iteration));
  base.push(jsonField("topic", String(event.topic)));

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
