/**
 * ANSI color utility respecting NO_COLOR / FORCE_COLOR env vars and TTY detection.
 * No external dependencies.
 */

const RESET = "\x1b[0m";

const STYLES: Record<string, string> = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  brightRed: "\x1b[91m",
  dimBlue: "\x1b[2;34m",
};

function colorsEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return process.stdout.isTTY === true;
}

export function color(text: string, ...styles: string[]): string {
  if (!colorsEnabled()) return text;
  const codes = styles
    .map((s) => STYLES[s])
    .filter((c): c is string => c !== undefined);
  if (codes.length === 0) return text;
  return codes.join("") + text + RESET;
}

export function strip(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
