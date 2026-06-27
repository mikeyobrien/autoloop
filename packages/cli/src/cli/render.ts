// CLI rendering helpers — formerly living in harness/index.ts.
//
// These functions are pure CLI output (each ends in a console.log or one of
// the printProjected* helpers). They read journal state and render it to
// stdout. They are NOT part of the embedded SDK surface: SDK consumers read
// journals directly or via packages/core readers in Phase 2.

import { collectUsage, formatUsage } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import {
  readAllJournals,
  readIfExists,
  readRunJournal,
  readRunLines,
} from "@mobrienv/autoloop-core/journal";
import { formatTimeline } from "@mobrienv/autoloop-core/journal-format";
import {
  collectArtifacts,
  formatArtifacts,
} from "@mobrienv/autoloop-harness/artifacts";
import {
  emptyFallback,
  ensureRenderRunId,
  iterationFieldForRun,
  resolveJournalFileForRun,
} from "@mobrienv/autoloop-harness/config-helpers";
import { coordinationFromLines } from "@mobrienv/autoloop-harness/coordination";
import {
  printProjectedMarkdown,
  printProjectedText,
} from "@mobrienv/autoloop-harness/display";
import { resolveEmitJournalFile } from "@mobrienv/autoloop-harness/emit";
import {
  diffIterations,
  renderIterationDiff,
} from "@mobrienv/autoloop-harness/iteration-diff";
import {
  collectMetricsRows,
  formatMetrics,
} from "@mobrienv/autoloop-harness/metrics";
import { readProgressMetrics } from "@mobrienv/autoloop-harness/progress";
import { renderRunScratchpadFull } from "@mobrienv/autoloop-harness/scratchpad";

export function renderScratchpadFormat(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  printProjectedMarkdown(
    emptyFallback(renderRunScratchpadFull(readRunLines(journalFile, runId))),
    format,
  );
}

export function renderPromptFormat(
  projectDir: string,
  iteration: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const prompt = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.start",
    "prompt",
  );
  if (!prompt) {
    console.log(`missing prompt projection for iteration ${iteration}`);
    return;
  }
  printProjectedMarkdown(prompt, format);
}

export function renderOutput(
  projectDir: string,
  iteration: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const output = iterationFieldForRun(
    journalFile,
    runId,
    iteration,
    "iteration.finish",
    "output",
  );
  console.log(output || `missing output projection for iteration ${iteration}`);
}

export function renderJournal(projectDir: string, runId?: string): void {
  if (runId) {
    const stateDir = config.stateDirPath(projectDir);
    const lines = readRunJournal(stateDir, runId);
    console.log(lines.join("\n"));
    return;
  }
  console.log(readIfExists(resolveEmitJournalFile(projectDir)));
}

export function renderAllJournals(projectDir: string): void {
  const stateDir = config.stateDirPath(projectDir);
  const lines = readAllJournals(stateDir);
  if (lines.length > 0) {
    console.log(lines.join("\n"));
  } else {
    renderJournal(projectDir);
  }
}

export function renderCoordinationFormat(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const lines = readRunLines(journalFile, runId);
  printProjectedMarkdown(emptyFallback(coordinationFromLines(lines)), format);
}

export function renderMetrics(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const lines = readRunLines(journalFile, runId);
  const rows = collectMetricsRows(lines);
  printProjectedText(formatMetrics(rows, format), format);
}

export function renderUsage(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const lines = readRunLines(journalFile, runId);
  const usage = collectUsage(lines);
  printProjectedText(formatUsage(usage, format), format);
}

export function renderProgress(
  projectDir: string,
  format: string,
  runIdOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(
    projectDir,
    runIdOverride,
  );
  const metrics = readProgressMetrics(readRunLines(journalFile, runId));
  if (format === "json") {
    printProjectedText(JSON.stringify(metrics, null, 2), format);
    return;
  }
  if (metrics.length === 0) {
    printProjectedText("No progress metric recorded for this run.", format);
    return;
  }
  const name = metrics[0].name;
  const lines = [
    `## Progress: ${name} — ${runId}`,
    "",
    ...metrics.map((m) => `iter ${m.iteration}: ${m.value}`),
  ];
  printProjectedText(lines.join("\n"), format);
}

export function renderIterationDiffInspect(args: string[]): void {
  let json = false;
  const positionals: string[] = [];
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a === "--format") {
      /* next token is the format; skip handling, terminal default */
    } else positionals.push(a);
  }
  const [runArg, iterAArg, iterBArg] = positionals;
  if (!runArg || iterAArg === undefined || iterBArg === undefined) {
    console.log(
      "Usage: autoloop inspect diff <run-id> <iterA> <iterB> [--json]",
    );
    return;
  }
  const projectDir = process.env.AUTOLOOP_PROJECT_DIR || ".";
  const { journalFile, runId } = resolveJournalFileForRun(projectDir, runArg);
  const lines = readRunLines(journalFile, runId);
  const diff = diffIterations(lines, Number(iterAArg), Number(iterBArg));
  if (json) {
    console.log(JSON.stringify({ run_id: runId, ...diff }, null, 2));
  } else {
    console.log(renderIterationDiff(runId, diff));
  }
}

export function renderJournalTimeline(
  projectDir: string,
  spec: {
    topics?: string[];
    iterFilter?: string;
    allRuns?: boolean;
    run?: string;
  },
): void {
  let lines: string[];
  if (spec.allRuns) {
    const stateDir = config.stateDirPath(projectDir);
    lines = readAllJournals(stateDir);
    if (lines.length === 0) {
      const journalFile = resolveEmitJournalFile(projectDir);
      lines = readRunLines(journalFile, ensureRenderRunId(journalFile));
    }
  } else {
    const { journalFile, runId } = resolveJournalAndRun(projectDir, spec.run);
    lines = readRunLines(journalFile, runId);
  }
  const output = formatTimeline(lines, {
    topics: spec.topics,
    iterFilter: spec.iterFilter,
  });
  console.log(output);
}

export function renderArtifacts(
  projectDir: string,
  format: string,
  runOverride?: string,
): void {
  const { journalFile, runId } = resolveJournalAndRun(projectDir, runOverride);
  const lines = readRunLines(journalFile, runId);
  const artifacts = collectArtifacts(lines, projectDir);
  if (format === "json") {
    console.log(JSON.stringify(artifacts, null, 2));
  } else {
    console.log(formatArtifacts(artifacts));
  }
}

function resolveJournalAndRun(
  projectDir: string,
  runIdOverride?: string,
): { journalFile: string; runId: string } {
  if (runIdOverride) {
    return resolveJournalFileForRun(projectDir, runIdOverride);
  }
  const journalFile = resolveEmitJournalFile(projectDir);
  return { journalFile, runId: ensureRenderRunId(journalFile) };
}
