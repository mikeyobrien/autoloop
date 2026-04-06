import { randomBytes } from "node:crypto";

export function listContains(list: string[], needle: string): boolean {
  return list.includes(needle);
}

export function listText(list: string[]): string {
  if (list.length === 0) return "(none)";
  return list.join(", ");
}

export function splitCsv(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function parseStringList(value: string): string[] {
  return parseStringListCsv(value.trim());
}

function parseStringListCsv(value: string): string[] {
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseStringListCsv(sliceOuter(value).trim());
  }
  return value
    .split(",")
    .map((s) => stripQuotes(s.trim()))
    .filter((s) => s !== "");
}

export function joinCsv(items: string[]): string {
  return items.join(",");
}

export function lineSep(): string {
  return "\n";
}

export function joinLines(lines: string[]): string {
  return lines.join(lineSep());
}

export function nonemptyOr(value: string, fallback: string): string {
  return value === "" ? fallback : value;
}

export function shellQuote(text: string): string {
  return "'" + replaceAll(text, "'", "'\"'\"'") + "'";
}

export function replaceAll(
  text: string,
  pattern: string,
  replacement: string,
): string {
  return text.split(pattern).join(replacement);
}

export function shellWords(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}

export function stripQuotes(value: string): string {
  return isQuoted(value) ? sliceOuter(value) : value;
}

export function isQuoted(value: string): boolean {
  return (
    value.startsWith('"') && value.endsWith('"') && value.length >= 2
  );
}

export function sliceOuter(text: string): string {
  return text.slice(1, -1);
}

export function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}


export function generateCompactId(prefix: string): string {
  const ts = Date.now();
  const encoded = intToBase36(ts);
  const suffix = randomSuffix();
  return `${prefix}-${encoded}-${suffix}`;
}

function randomSuffix(): string {
  return randomBytes(16).toString("hex").slice(0, 4).toLowerCase();
}

function intToBase36(n: number): string {
  if (n === 0) return "0";
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  let val = n;
  while (val > 0) {
    result = chars[val % 36] + result;
    val = Math.floor(val / 36);
  }
  return result;
}
