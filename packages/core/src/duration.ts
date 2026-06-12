// Human-readable duration parsing for config values.
//
// Pure string → milliseconds conversion; no fs, no env. Used by the
// `getDuration` config accessor so keys like `event_loop.max_runtime`
// accept "3d" / "1h30m" alongside plain millisecond integers.

/** Node setTimeout/execSync timeout cap: 2^31 - 1 ms (~24.8 days). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

const SEGMENT_RE = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration string to milliseconds.
 *
 * Accepts a bare integer (milliseconds) or one or more `<number><unit>`
 * segments with units ms/s/m/h/d, e.g. "45s", "90m", "12h", "3d", "1h30m",
 * "1.5h". Returns null for empty, negative, or partially-matching input
 * ("5mx", "1h 30m", "h").
 */
export function parseDurationMs(raw: string): number | null {
  const input = raw.trim();
  if (input === "") return null;
  if (/^\d+$/.test(input)) return parseInt(input, 10);
  let totalMs = 0;
  let matchedLength = 0;
  for (const match of input.matchAll(SEGMENT_RE)) {
    totalMs += Number.parseFloat(match[1]) * UNIT_MS[match[2]];
    matchedLength += match[0].length;
  }
  if (matchedLength === 0 || matchedLength !== input.length) return null;
  return Math.round(totalMs);
}
