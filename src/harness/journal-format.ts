/**
 * Journal timeline formatting utilities.
 * Converts raw journal events into a filterable, color-coded terminal timeline.
 */

import { color } from "../cli/color.js";
import { decodeEvent } from "../events/decode.js";
import type { JournalEvent } from "../events/types.js";
import { extractField } from "../json.js";

/** Category-to-color mapping per RFC */
const CATEGORY_COLORS: Record<string, string[]> = {
  loop: ["cyan"],
  iteration: ["yellow"],
  backend: ["dim", "gray"],
  review: ["magenta"],
  coordination: ["blue"],
  operator: ["brightRed"],
  routing: ["dimBlue"],
  error: ["red", "bold"],
};

/** Map a topic string to its category name. */
export function topicCategory(topic: string): string {
  if (topic === "event.invalid" || topic === "loop.stop") return "error";
  const prefix = topic.split(".")[0];
  switch (prefix) {
    case "loop":
      return "loop";
    case "iteration":
      return "iteration";
    case "backend":
      return "backend";
    case "review":
      return "review";
    case "issue":
    case "slice":
    case "context":
    case "chain":
    case "artifact":
      return "coordination";
    case "operator":
      return "operator";
    case "wave":
      return "routing";
    default:
      return "routing";
  }
}

/**
 * Check if a topic matches a filter pattern.
 * Supports exact match, category prefix, and glob with `*`.
 */
export function topicMatchesFilter(topic: string, pattern: string): boolean {
  if (topic === pattern) return true;
  // Category match: bare category name like "loop" matches "loop.*"
  if (!pattern.includes(".") && !pattern.includes("*")) {
    return topicCategory(topic) === pattern || topic.startsWith(`${pattern}.`);
  }
  // Glob: convert * to regex
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    return re.test(topic);
  }
  return false;
}

/** Extract a one-line summary from a decoded event. */
function eventSummary(event: JournalEvent, maxLen: number): string {
  if (event.shape === "payload") {
    const text = event.payload.replace(/\n/g, " ").trim();
    return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
  }
  // fields event: join key=value pairs
  const pairs = Object.entries(event.fields)
    .filter(([k]) => k !== "ts" && k !== "timestamp")
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return pairs.length > maxLen ? `${pairs.slice(0, maxLen - 3)}...` : pairs;
}

/** Extract timestamp from a raw JSON line (not decoded event). */
function extractTimestamp(line: string): string {
  return extractField(line, "timestamp") || extractField(line, "ts") || "";
}

/** Format an ISO timestamp to HH:MM:SS local time. */
function formatTime(isoTs: string): string {
  if (!isoTs) return "--:--:--";
  try {
    const d = new Date(isoTs);
    if (Number.isNaN(d.getTime())) return "--:--:--";
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "--:--:--";
  }
}

/** Format a single event into a one-line string with color. */
export function eventOneLiner(
  line: string,
  event: JournalEvent,
  maxWidth = 120,
): string {
  const ts = formatTime(extractTimestamp(line));
  const cat = topicCategory(event.topic);
  const colors = CATEGORY_COLORS[cat] ?? ["dim"];
  const topicStr = event.topic.padEnd(20);
  const summaryBudget = Math.max(20, maxWidth - 10 - 20 - 4);
  const summary = eventSummary(event, summaryBudget);
  return `  ${color(ts, "dim")}  ${color(topicStr, ...colors)}  ${summary}`;
}

interface TimelineOptions {
  topics?: string[];
  iterFilter?: string;
  maxWidth?: number;
}

/**
 * Format an array of raw journal lines into a grouped, colored timeline string.
 * Groups events by iteration, with separator lines.
 */
export function formatTimeline(
  lines: string[],
  opts: TimelineOptions = {},
): string {
  const { topics, iterFilter, maxWidth = 120 } = opts;
  const output: string[] = [];
  let currentIter = "";

  let matched = 0;
  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event) continue;

    // Apply topic filter
    if (topics && topics.length > 0) {
      if (!topics.some((t) => topicMatchesFilter(event.topic, t))) continue;
    }

    // Apply iteration filter
    const iter = event.iteration ?? "";
    if (iterFilter && iter !== iterFilter) continue;

    // Iteration grouping header
    const iterLabel = iter || "system";
    if (iterLabel !== currentIter) {
      currentIter = iterLabel;
      const sep = `\u2500\u2500 iter ${iterLabel} `.padEnd(60, "\u2500");
      output.push("");
      output.push(color(sep, "dim"));
    }

    output.push(eventOneLiner(line, event, maxWidth));
    matched++;
  }

  if (matched === 0) {
    if (topics || iterFilter) {
      return "No events match the given filters.";
    }
    return "No journal events found.";
  }

  return output.join("\n");
}
