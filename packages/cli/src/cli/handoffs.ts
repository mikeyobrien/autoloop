import { STOP_REASONS } from "@mobrienv/autoloop-harness/types";

type Maybe<T> = T | null;

interface UnknownAttribution {
  status: "unknown";
}

type TerminalReason = (typeof STOP_REASONS)[number] | "abandoned";

type ObservationDetail =
  | {
      kind: "decision";
      recent_event: Maybe<string>;
      suggested_roles: Maybe<string[]>;
      allowed_events: Maybe<string[]>;
      backpressure_present: Maybe<boolean>;
    }
  | { kind: "accepted"; event: string; source: "agent" }
  | {
      kind: "validation";
      validation: "rejected";
      emitted: Maybe<string>;
      recent_event: Maybe<string>;
      suggested_roles: Maybe<string[]>;
      allowed_events: Maybe<string[]>;
    }
  | { kind: "retry"; pause_count: Maybe<number>; backoff_ms: Maybe<number> }
  | {
      kind: "usage";
      input_tokens: Maybe<number>;
      output_tokens: Maybe<number>;
      cache_read_tokens: Maybe<number>;
      cache_write_tokens: Maybe<number>;
      total_tokens: Maybe<number>;
      cost_usd: Maybe<number>;
    }
  | {
      kind: "finish";
      scope: "backend" | "iteration";
      exit_code: Maybe<number>;
      timed_out: Maybe<boolean>;
      elapsed_s: Maybe<number>;
    }
  | {
      kind: "terminal";
      event: "loop.complete" | "loop.stop";
      reason: Maybe<TerminalReason>;
    };

export type HandoffObservation = {
  ordinal: number;
  iteration: Maybe<string>;
  timestamp: Maybe<string>;
  actor_role: UnknownAttribution;
  decision_maker: UnknownAttribution;
} & ObservationDetail;

export interface HandoffReport {
  schema_version: 1;
  run_id: string;
  ordering: "journal_input";
  completeness: "not_established";
  observations: HandoffObservation[];
}

type JsonObject = Record<string, unknown>;

const TERMINAL_REASONS: ReadonlySet<string> = new Set([
  ...STOP_REASONS,
  "abandoned",
]);

const DECIMAL = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export function handoffsFromLines(
  runId: string,
  lines: readonly string[],
): HandoffReport {
  const observations: HandoffObservation[] = [];
  for (const line of lines) {
    const record = parseObject(line);
    if (!record || record.run !== runId) continue;
    const detail = observe(record);
    if (!detail) continue;
    observations.push({
      ordinal: observations.length + 1,
      iteration: text(record.iteration),
      timestamp: timestamp(record.ts ?? record.timestamp),
      actor_role: { status: "unknown" },
      decision_maker: { status: "unknown" },
      ...detail,
    });
  }
  return {
    schema_version: 1,
    run_id: runId,
    ordering: "journal_input",
    completeness: "not_established",
    observations,
  };
}

function observe(record: JsonObject): ObservationDetail | null {
  const topic = record.topic;
  if (typeof topic !== "string" || topic === "") return null;
  if ("payload" in record) return acceptedEmit(topic, record);
  const fields = isObject(record.fields) ? record.fields : {};
  switch (topic) {
    case "iteration.start":
      return {
        kind: "decision",
        recent_event: text(fields.recent_event),
        suggested_roles: list(fields.suggested_roles),
        allowed_events: list(fields.allowed_events),
        backpressure_present:
          typeof fields.backpressure === "string"
            ? fields.backpressure !== ""
            : null,
      };
    case "event.invalid":
      return {
        kind: "validation",
        validation: "rejected",
        emitted: text(fields.emitted),
        recent_event: text(fields.recent_event),
        suggested_roles: list(fields.suggested_roles),
        allowed_events: list(fields.allowed_events),
      };
    case "backend.transient":
      return {
        kind: "retry",
        pause_count: num(fields.pause_count),
        backoff_ms: num(fields.backoff_ms),
      };
    case "backend.usage":
      return {
        kind: "usage",
        input_tokens: num(fields.input_tokens),
        output_tokens: num(fields.output_tokens),
        cache_read_tokens: num(fields.cache_read_tokens),
        cache_write_tokens: num(fields.cache_write_tokens),
        total_tokens: num(fields.total_tokens),
        cost_usd: num(fields.cost_usd),
      };
    case "backend.finish":
    case "iteration.finish":
      return {
        kind: "finish",
        scope: topic === "backend.finish" ? "backend" : "iteration",
        exit_code: num(fields.exit_code),
        timed_out: bool(fields.timed_out),
        elapsed_s: num(fields.elapsed_s),
      };
    case "loop.complete":
    case "loop.stop":
      return {
        kind: "terminal",
        event: topic,
        reason: isTerminalReason(fields.reason) ? fields.reason : null,
      };
    default:
      return null;
  }
}

function acceptedEmit(
  topic: string,
  record: JsonObject,
): ObservationDetail | null {
  if (typeof record.payload !== "string" || record.source !== "agent") {
    return null;
  }
  if (topic === "completion.accepted") return null;
  return { kind: "accepted", event: topic, source: "agent" };
}

function parseObject(line: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): Maybe<string> {
  return typeof value === "string" && value !== "" ? value : null;
}

function timestamp(value: unknown): Maybe<string> {
  const raw = text(value);
  return raw !== null && Number.isFinite(Date.parse(raw)) ? raw : null;
}

function list(value: unknown): Maybe<string[]> {
  if (typeof value !== "string") return null;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function num(value: unknown): Maybe<number> {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !DECIMAL.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): Maybe<boolean> {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function isTerminalReason(value: unknown): value is TerminalReason {
  return typeof value === "string" && TERMINAL_REASONS.has(value);
}

export function formatHandoffs(report: HandoffReport): string {
  const header = [
    `## Handoffs: ${report.run_id}`,
    "Order: journal input. Completeness: not established. Actor and decision maker: unknown.",
    "",
  ];
  if (report.observations.length === 0) {
    return [...header, "No handoff observations recorded for this run."].join(
      "\n",
    );
  }
  return [...header, ...report.observations.map(formatRow)].join("\n");
}

function formatRow(row: HandoffObservation): string {
  const prefix = `#${row.ordinal} iter ${row.iteration ?? "?"} ${row.timestamp ?? "?"}`;
  return `${prefix} ${row.kind} ${describe(row)}`;
}

function describe(row: HandoffObservation): string {
  switch (row.kind) {
    case "decision":
      return pairs({
        recent_event: row.recent_event,
        suggested_roles: row.suggested_roles,
        allowed_events: row.allowed_events,
        backpressure_present: row.backpressure_present,
      });
    case "accepted":
      return pairs({ event: row.event, source: row.source });
    case "validation":
      return pairs({
        emitted: row.emitted,
        recent_event: row.recent_event,
        suggested_roles: row.suggested_roles,
        allowed_events: row.allowed_events,
      });
    case "retry":
      return pairs({
        pause_count: row.pause_count,
        backoff_ms: row.backoff_ms,
      });
    case "usage":
      return pairs({
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_write_tokens: row.cache_write_tokens,
        total_tokens: row.total_tokens,
        cost_usd: row.cost_usd,
      });
    case "finish":
      return pairs({
        scope: row.scope,
        exit_code: row.exit_code,
        timed_out: row.timed_out,
        elapsed_s: row.elapsed_s,
      });
    case "terminal":
      return pairs({ event: row.event, reason: row.reason });
  }
}

function pairs(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
}

function formatValue(value: unknown): string {
  if (value === null) return "unknown";
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  return String(value);
}
