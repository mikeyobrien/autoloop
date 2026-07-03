import {
  extractField,
  extractIteration,
  extractTopic,
} from "@mobrienv/autoloop-core/journal";

export interface TextDelta {
  aChars: number;
  bChars: number;
  charDelta: number;
  linesAdded: number;
  linesRemoved: number;
  changed: boolean;
}

export interface IterationDiff {
  iterA: number;
  iterB: number;
  prompt: TextDelta;
  output: TextDelta;
  cost: { aUsd: number; bUsd: number; deltaUsd: number };
  /** Event topics emitted in one iteration but not the other (structural). */
  events: { onlyInA: string[]; onlyInB: string[] };
}

function linesOf(runLines: string[], iter: number): string[] {
  const want = String(iter);
  return runLines.filter((l) => extractIteration(l) === want);
}

function fieldFor(lines: string[], topic: string, field: string): string {
  // Last matching line wins (the final value journaled for that iteration).
  for (let i = lines.length - 1; i >= 0; i--) {
    if (extractTopic(lines[i]) === topic) return extractField(lines[i], field);
  }
  return "";
}

function topicsOf(lines: string[]): Set<string> {
  return new Set(lines.map((l) => extractTopic(l)).filter(Boolean));
}

function costOf(lines: string[]): number {
  let sum = 0;
  for (const l of lines) {
    if (extractTopic(l) !== "backend.usage") continue;
    const v = Number(extractField(l, "cost_usd"));
    if (Number.isFinite(v)) sum += v;
  }
  return Math.round(sum * 1e6) / 1e6;
}

/** Multiset line diff: counts of lines present in b-not-a (added) / a-not-b (removed). */
function textDelta(a: string, b: string): TextDelta {
  const aLines = a ? a.split("\n") : [];
  const bLines = b ? b.split("\n") : [];
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const am = count(aLines);
  const bm = count(bLines);
  let added = 0;
  let removed = 0;
  for (const [line, n] of bm) added += Math.max(0, n - (am.get(line) ?? 0));
  for (const [line, n] of am) removed += Math.max(0, n - (bm.get(line) ?? 0));
  return {
    aChars: a.length,
    bChars: b.length,
    charDelta: b.length - a.length,
    linesAdded: added,
    linesRemoved: removed,
    changed: a !== b,
  };
}

/**
 * Structural diff between two journaled iterations of a run: prompt (assembled
 * context), backend output, cost, and the emitted-event topic set. Pure over
 * the run's journal lines — the durable journal is the trustworthy source.
 */
export function diffIterations(
  runLines: string[],
  iterA: number,
  iterB: number,
): IterationDiff {
  const a = linesOf(runLines, iterA);
  const b = linesOf(runLines, iterB);
  const aTopics = topicsOf(a);
  const bTopics = topicsOf(b);
  const aUsd = costOf(a);
  const bUsd = costOf(b);
  return {
    iterA,
    iterB,
    prompt: textDelta(
      fieldFor(a, "iteration.start", "prompt"),
      fieldFor(b, "iteration.start", "prompt"),
    ),
    output: textDelta(
      fieldFor(a, "iteration.finish", "output"),
      fieldFor(b, "iteration.finish", "output"),
    ),
    cost: { aUsd, bUsd, deltaUsd: Math.round((bUsd - aUsd) * 1e6) / 1e6 },
    events: {
      onlyInA: [...aTopics].filter((t) => !bTopics.has(t)).sort(),
      onlyInB: [...bTopics].filter((t) => !aTopics.has(t)).sort(),
    },
  };
}

/** Render a structural iteration diff as a human-readable report. */
export function renderIterationDiff(runId: string, d: IterationDiff): string {
  const t = (label: string, x: TextDelta) =>
    `${label}: ${x.changed ? "changed" : "identical"} (${x.aChars}→${x.bChars} chars, Δ${x.charDelta >= 0 ? "+" : ""}${x.charDelta}; +${x.linesAdded}/-${x.linesRemoved} lines)`;
  return [
    `## Diff ${runId}: iter ${d.iterA} → ${d.iterB}`,
    "",
    t("prompt/context", d.prompt),
    t("output", d.output),
    `cost: $${d.cost.aUsd} → $${d.cost.bUsd} (Δ${d.cost.deltaUsd >= 0 ? "+" : ""}${d.cost.deltaUsd})`,
    `events only in ${d.iterA}: ${d.events.onlyInA.join(", ") || "(none)"}`,
    `events only in ${d.iterB}: ${d.events.onlyInB.join(", ") || "(none)"}`,
  ].join("\n");
}
