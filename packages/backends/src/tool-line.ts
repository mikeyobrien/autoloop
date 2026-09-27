/**
 * One-line tool call summaries for the verbose stderr stream. A start line
 * says what the agent is doing (`→ bash  rg -n foo`); a failure line says
 * what broke and why (`✗ write  a.md — EACCES`). Successes print nothing.
 */

import {
  resolveColumns,
  truncateToWidth,
} from "@mobrienv/autoloop-core/terminal-width";

/** A tool call seen at start, kept so its end can be paired back to it. */
export interface ToolCallInfo {
  name: string;
  args: unknown;
}

const DEFAULT_WIDTH = 120;
const SHELL_TOOLS = new Set(["bash", "shell", "exec"]);
const FILE_TOOLS = new Set(["read", "edit", "write"]);
const SEARCH_TOOLS = new Set(["grep", "find", "ls", "glob"]);

export function toolLineWidth(): number {
  return resolveColumns(process.stderr, process.env, DEFAULT_WIDTH);
}

export function summarizeToolArgs(toolName: string, args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args !== "object") return String(args);
  const record = args as Record<string, unknown>;
  const name = toolName.toLowerCase();
  if (SHELL_TOOLS.has(name) && typeof record.command === "string") {
    return record.command;
  }
  if (FILE_TOOLS.has(name)) {
    const path =
      stringField(record, "path") ?? stringField(record, "file_path");
    if (path !== undefined) return path;
  }
  if (SEARCH_TOOLS.has(name)) {
    const pattern = stringField(record, "pattern");
    const path = stringField(record, "path");
    if (pattern !== undefined) return path ? `${pattern} in ${path}` : pattern;
    if (path !== undefined) return path;
  }
  const first = Object.values(record).find(
    (value) => typeof value === "string",
  );
  if (typeof first === "string") return first;
  const json = JSON.stringify(args);
  return json === "{}" ? "" : json;
}

export function formatToolStart(
  toolName: string,
  args: unknown,
  width: number,
): string {
  return toolLine(`→ ${toolName}`, summarizeToolArgs(toolName, args), width);
}

export function formatToolFailure(
  toolName: string,
  args: unknown,
  detail: string,
  width: number,
): string {
  const summary = summarizeToolArgs(toolName, args);
  const reason = firstLine(detail);
  const body = [summary, reason].filter(Boolean).join(" — ");
  return toolLine(`✗ ${toolName}`, body, width);
}

/**
 * First non-empty line of a tool result: a string, or an object/array
 * carrying `{type:"text", text}` content parts.
 */
export function toolResultText(result: unknown): string {
  if (typeof result === "string") return firstLine(result);
  const content = Array.isArray(result)
    ? result
    : (result as { content?: unknown } | null | undefined)?.content;
  if (typeof content === "string") return firstLine(content);
  if (!Array.isArray(content)) return "";
  for (const part of content) {
    const text = (part as { type?: string; text?: unknown } | null)?.text;
    if (typeof text !== "string") continue;
    const line = firstLine(text);
    if (line) return line;
  }
  return "";
}

function toolLine(head: string, body: string, width: number): string {
  const rest = collapse(body);
  const line = rest ? `${collapse(head)}  ${rest}` : collapse(head);
  return `${truncateToWidth(line, Math.max(1, width))}\n`;
}

/**
 * First non-empty line. A line ending in `:` is only a heading (pi's
 * `Validation failed for tool "write":`), so the next line is appended.
 */
function firstLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [first = "", second] = lines;
  return first.endsWith(":") && second ? `${first} ${second}` : first;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
