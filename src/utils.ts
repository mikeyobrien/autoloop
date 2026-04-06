import { randomBytes } from "node:crypto";

const READABLE_ADJECTIVES = [
  "able",
  "agile",
  "alert",
  "allied",
  "ample",
  "ardent",
  "artful",
  "atomic",
  "aware",
  "basic",
  "binary",
  "bold",
  "brave",
  "brief",
  "brisk",
  "bright",
  "broad",
  "calm",
  "candid",
  "causal",
  "central",
  "clean",
  "clear",
  "clever",
  "close",
  "cobalt",
  "cool",
  "cosmic",
  "crisp",
  "deft",
  "direct",
  "eager",
  "early",
  "exact",
  "fair",
  "fast",
  "fierce",
  "final",
  "fine",
  "firm",
  "fluent",
  "focal",
  "fresh",
  "full",
  "future",
  "gentle",
  "glad",
  "golden",
  "grand",
  "graphic",
  "guided",
  "honest",
  "ideal",
  "instant",
  "keen",
  "kind",
  "lean",
  "level",
  "lucid",
  "lucky",
  "lunar",
  "major",
  "mellow",
  "meta",
  "mild",
  "mobile",
  "modern",
  "native",
  "neat",
  "neural",
  "nimble",
  "noble",
  "open",
  "orbital",
  "plain",
  "poised",
  "prime",
  "prompt",
  "proud",
  "pure",
  "quick",
  "quiet",
  "rapid",
  "ready",
  "real",
  "robust",
  "sane",
  "sharp",
  "silent",
  "simple",
  "sleek",
  "sly",
  "smart",
  "smooth",
  "solid",
  "sonic",
  "sparse",
  "stable",
  "steady",
  "still",
  "strong",
  "subtle",
  "super",
  "swift",
  "tidy",
  "tuned",
  "vivid",
  "warm",
  "whole",
  "wise",
  "zesty",
] as const;

const READABLE_NOUNS = [
  "agent",
  "anchor",
  "array",
  "atlas",
  "batch",
  "beacon",
  "branch",
  "bridge",
  "broker",
  "build",
  "cache",
  "chain",
  "check",
  "cipher",
  "claim",
  "client",
  "cloud",
  "cluster",
  "code",
  "comet",
  "commit",
  "console",
  "context",
  "cortex",
  "critic",
  "daemon",
  "data",
  "delta",
  "drift",
  "drive",
  "editor",
  "embed",
  "engine",
  "event",
  "factor",
  "field",
  "filter",
  "flame",
  "flow",
  "forge",
  "frame",
  "graph",
  "grid",
  "guard",
  "guide",
  "harbor",
  "helper",
  "index",
  "kernel",
  "ledger",
  "lens",
  "light",
  "link",
  "loop",
  "matrix",
  "memory",
  "mesh",
  "model",
  "module",
  "monitor",
  "node",
  "orbit",
  "parser",
  "patch",
  "path",
  "pilot",
  "pipe",
  "plan",
  "probe",
  "prompt",
  "pulse",
  "queue",
  "radar",
  "relay",
  "review",
  "rover",
  "route",
  "router",
  "runner",
  "schema",
  "scout",
  "script",
  "sensor",
  "server",
  "shard",
  "signal",
  "socket",
  "solver",
  "source",
  "spark",
  "stack",
  "state",
  "stream",
  "switch",
  "sync",
  "system",
  "task",
  "thread",
  "token",
  "tool",
  "trace",
  "track",
  "trail",
  "vector",
  "vault",
  "vision",
  "watch",
  "wave",
  "worker",
  "writer",
] as const;

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
  return `'${replaceAll(text, "'", "'\"'\"'")}'`;
}

export function replaceAll(
  text: string,
  pattern: string,
  replacement: string,
): string {
  return text.split(pattern).join(replacement);
}

export function rewriteLoopStatePaths(text: string, stateDir: string): string {
  return text.replace(
    /(^|[^A-Za-z0-9_-])(?:\.\/)?\.autoloop(?=\/|\b)/g,
    (_, prefix: string) => `${prefix}${stateDir}`,
  );
}

export function expandTemplatePlaceholders(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (match, key: string) =>
    Object.hasOwn(vars, key) ? vars[key] : match,
  );
}

export function shellWords(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}

export function stripQuotes(value: string): string {
  return isQuoted(value) ? sliceOuter(value) : value;
}

export function isQuoted(value: string): boolean {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2;
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

export function generateReadableId(): string {
  return `${pickRandom(READABLE_ADJECTIVES)}-${pickRandom(READABLE_NOUNS)}`;
}

export function readableIdCapacity(): number {
  return READABLE_ADJECTIVES.length * READABLE_NOUNS.length;
}

export function uniqueGeneratedId(
  generate: () => string,
  existing: ReadonlySet<string>,
  maxAttempts = 64,
): string | undefined {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generate();
    if (!existing.has(candidate)) return candidate;
  }
  return undefined;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[randomIndex(items.length)];
}

function randomIndex(length: number): number {
  return randomBytes(2).readUInt16BE(0) % length;
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
