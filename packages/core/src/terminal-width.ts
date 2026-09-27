import { eastAsianWidth } from "get-east-asian-width";

const ZERO_WIDTH = /^(?:\p{M}|\p{Cc}|\u200d|[\ufe00-\ufe0f])$/u;

/** Terminal cells a string occupies: wide characters take 2, marks take 0. */
export function displayWidth(text: string): number {
  let cells = 0;
  for (const char of text) cells += charWidth(char);
  return cells;
}

/** Cut `text` to at most `width` cells, ending in `…` when anything was cut. */
export function truncateToWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  if (width <= 0) return "";
  let out = "";
  let cells = 0;
  for (const char of text) {
    const w = charWidth(char);
    if (cells + w > width - 1) break;
    out += char;
    cells += w;
  }
  return `${out}…`;
}

/**
 * Usable terminal columns. A PTY can report 0 columns, so only a positive
 * stream width counts; then a positive COLUMNS; then the fallback.
 */
export function resolveColumns(
  stream: { columns?: number },
  env: NodeJS.ProcessEnv,
  fallback: number,
): number {
  if (typeof stream.columns === "number" && stream.columns > 0)
    return stream.columns;
  const fromEnv = Number(env.COLUMNS);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : fallback;
}

function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char)) return 0;
  return eastAsianWidth(char.codePointAt(0) as number);
}
