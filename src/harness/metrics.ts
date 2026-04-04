import { decodeEvent } from "../events/decode.js";
import { isSystemEvent } from "../events/guards.js";
import { jsonField } from "../json.js";
import { table } from "../markdown.js";

interface MetricsRow {
  iteration: string;
  role: string;
  event: string;
  elapsedS: string;
  exitCode: string;
  timedOut: string;
  outcome: string;
}

export function collectMetricsRows(lines: string[]): MetricsRow[] {
  const rows: MetricsRow[] = [];

  for (const line of lines) {
    const event = decodeEvent(line);
    if (!event) continue;

    if (event.topic === "iteration.start" && event.shape === "fields") {
      const roles = event.fields["suggested_roles"] ?? "";
      const role = firstCsvValue(roles);
      rows.push({
        iteration: event.iteration ?? "",
        role,
        event: "none",
        elapsedS: "",
        exitCode: "",
        timedOut: "false",
        outcome: "continue",
      });
      continue;
    }

    if (event.topic === "iteration.finish" && event.shape === "fields") {
      const iter = event.iteration ?? "";
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].iteration === iter) {
          rows[i].exitCode = event.fields["exit_code"] ?? "";
          rows[i].timedOut = event.fields["timed_out"] ?? "";
          rows[i].elapsedS = event.fields["elapsed_s"] ?? "";
          rows[i].outcome = computeOutcome(
            rows[i].exitCode,
            rows[i].timedOut,
            rows[i].event,
          );
          break;
        }
      }
      continue;
    }

    if (!isSystemEvent(event)) {
      const iter = event.iteration ?? "";
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].iteration === iter) {
          rows[i].event = String(event.topic);
          break;
        }
      }
    }
  }

  return rows;
}

export function formatMetrics(rows: MetricsRow[], format: string): string {
  switch (format) {
    case "csv":
      return formatMetricsCsv(rows);
    case "json":
      return formatMetricsJson(rows);
    default:
      return formatMetricsMd(rows);
  }
}

function formatMetricsMd(rows: MetricsRow[]): string {
  if (rows.length === 0) return "No metrics data available.";
  const headers = [
    "iteration",
    "role",
    "event",
    "elapsed_s",
    "exit_code",
    "timed_out",
    "outcome",
  ];
  const tableRows = rows.map((r) => [
    r.iteration,
    r.role,
    r.event,
    r.elapsedS,
    r.exitCode,
    r.timedOut,
    r.outcome,
  ]);
  return table(headers, tableRows) + "\n\n" + metricsSummary(rows);
}

function metricsSummary(rows: MetricsRow[]): string {
  const total = rows.length;
  const elapsed = sumElapsed(rows);
  const distinct = countDistinctEvents(rows);
  return (
    "**Summary:** " +
    total +
    " iterations, " +
    elapsed +
    "s total elapsed, " +
    distinct +
    " distinct events"
  );
}

function sumElapsed(rows: MetricsRow[]): string {
  let sum = 0;
  for (const row of rows) {
    if (row.elapsedS) {
      const val = parseFloat(row.elapsedS);
      if (!isNaN(val)) sum += val;
    }
  }
  return String(sum);
}

function countDistinctEvents(rows: MetricsRow[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.event !== "none") seen.add(row.event);
  }
  return seen.size;
}

function formatMetricsCsv(rows: MetricsRow[]): string {
  const header = "iteration,role,event,elapsed_s,exit_code,timed_out,outcome";
  if (rows.length === 0) return header;
  const csvRows = rows.map(
    (r) =>
      csvQuote(r.iteration) +
      "," +
      csvQuote(r.role) +
      "," +
      csvQuote(r.event) +
      "," +
      csvQuote(r.elapsedS) +
      "," +
      csvQuote(r.exitCode) +
      "," +
      csvQuote(r.timedOut) +
      "," +
      csvQuote(r.outcome),
  );
  return header + "\n" + csvRows.join("\n");
}

function csvQuote(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function formatMetricsJson(rows: MetricsRow[]): string {
  if (rows.length === 0) return "[]";
  const items = rows.map(
    (r) =>
      "{" +
      jsonNumberOrNull("iteration", r.iteration) +
      ", " +
      jsonField("role", r.role) +
      ", " +
      jsonField("event", r.event) +
      ", " +
      jsonNumberOrNull("elapsed_s", r.elapsedS) +
      ", " +
      jsonNumberOrNull("exit_code", r.exitCode) +
      ", " +
      jsonBoolField("timed_out", r.timedOut) +
      ", " +
      jsonField("outcome", r.outcome) +
      "}",
  );
  return "[" + items.join(", ") + "]";
}

function jsonNumberOrNull(key: string, value: string): string {
  if (!value) return '"' + key + '": null';
  return '"' + key + '": ' + value;
}

function jsonBoolField(key: string, value: string): string {
  return '"' + key + '": ' + (value === "true" ? "true" : "false");
}

function computeOutcome(exitCode: string, timedOut: string, event: string): string {
  if (timedOut === "true") return "timeout";
  if (exitCode === "0") return event === "none" ? "continue" : "emitted";
  return "failed";
}

function firstCsvValue(csv: string): string {
  if (!csv) return "";
  const first = csv.split(",")[0];
  return first?.trim() ?? "";
}
