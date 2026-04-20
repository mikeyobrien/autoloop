// CLI rendering helpers — formerly living in harness/index.ts.
//
// These functions are pure CLI output (each ends in a console.log or one of
// the printProjected* helpers). They read journal state and render it to
// stdout. They are NOT part of the embedded SDK surface: SDK consumers read
// journals directly or via packages/core readers in Phase 2.

import * as config from "../config.js";
import { collectArtifacts, formatArtifacts } from "../harness/artifacts.js";
import {
  emptyFallback,
  ensureRenderRunId,
  iterationFieldForRun,
  resolveJournalFileForRun,
} from "../harness/config-helpers.js";
import { coordinationFromLines } from "../harness/coordination.js";
import {
  printProjectedMarkdown,
  printProjectedText,
} from "../harness/display.js";
import { resolveEmitJournalFile } from "../harness/emit.js";
import {
  readAllJournals,
  readIfExists,
  readRunJournal,
  readRunLines,
} from "../harness/journal.js";
import { formatTimeline } from "../harness/journal-format.js";
import { collectMetricsRows, formatMetrics } from "../harness/metrics.js";
import { renderRunScratchpadFull } from "../harness/scratchpad.js";

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
