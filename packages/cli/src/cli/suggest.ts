// "Did you mean …?" suggestions for mistyped commands, subcommands, and
// preset names. One shared implementation so every error path suggests with
// the same tolerance.

/** Classic Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, substitution);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Return the closest candidate within an edit-distance budget scaled to the
 * input length (minimum 2), or null when nothing is plausibly close.
 * Prefix matches win outright so `art` suggests `artifacts`.
 */
export function suggestClosest(
  input: string,
  candidates: string[],
): string | null {
  if (!input) return null;
  const needle = input.toLowerCase();
  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith(needle)) return candidate;
  }
  const budget = Math.max(2, Math.floor(needle.length / 3));
  let best: string | null = null;
  let bestDistance = budget + 1;
  for (const candidate of candidates) {
    const distance = editDistance(needle, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Render the standard hint line, or an empty string when no suggestion. */
export function didYouMean(input: string, candidates: string[]): string {
  const suggestion = suggestClosest(input, candidates);
  return suggestion ? `Did you mean \`${suggestion}\`?` : "";
}
