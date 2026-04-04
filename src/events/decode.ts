import type { FieldsEvent, JournalEvent, PayloadEvent } from "./types.js";

export function decodeEvent(line: string): JournalEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const run = typeof parsed.run === "string" ? parsed.run : "";
    const topic = typeof parsed.topic === "string" ? parsed.topic : "";
    const iteration = typeof parsed.iteration === "string" ? parsed.iteration : undefined;

    if (typeof parsed.payload === "string") {
      const event: PayloadEvent = {
        shape: "payload",
        run,
        topic,
        payload: parsed.payload,
      };
      if (iteration) event.iteration = iteration;
      if (typeof parsed.source === "string") event.source = parsed.source;
      return event;
    }

    const rawFields = isObject(parsed.fields) ? parsed.fields : {};
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawFields)) {
      fields[key] = value === null || value === undefined ? "" : String(value);
    }
    const event: FieldsEvent = {
      shape: "fields",
      run,
      topic,
      fields,
      rawFields,
    };
    if (iteration) event.iteration = iteration;
    return event;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
