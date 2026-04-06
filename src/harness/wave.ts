import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonField } from "../json.js";
import * as md from "../markdown.js";
import { generateCompactId, joinCsv } from "../utils.js";
import { appendEvent, readIfExists } from "./journal.js";
import type { IterationContext } from "./prompt.js";
import type { LoopContext } from "./types.js";
import { finalizeParallelWave } from "./wave/finalize-wave.js";
import {
  joinParallelBranches,
  launchParallelBranches,
  prepareParallelBranches,
} from "./wave/launch-branches.js";
import { parseParallelObjectives } from "./wave/parse-objectives.js";
import type { BranchResult, WaveResult } from "./wave/types.js";

export {
  continueAfterParallelJoin,
  stopAfterParallelWave,
} from "./wave/finalize-wave.js";
export type { WaveResult } from "./wave/types.js";

export function executeParallelWave(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  emittedPayload: string,
): WaveResult {
  const markerPath = activeWaveMarkerPath(loop);

  if (existsSync(markerPath)) {
    return rejectActiveWave(loop, iter, emittedTopic, markerPath);
  }

  const parsed = parseParallelObjectives(
    emittedPayload,
    loop.parallel.maxBranches,
  );
  if (!parsed.ok) {
    return rejectPayload(loop, iter, emittedTopic, parsed.reason);
  }

  return executeWaveWithObjectives(
    loop,
    iter,
    emittedTopic,
    parsed.objectives,
    markerPath,
  );
}

function rejectActiveWave(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  markerPath: string,
): WaveResult {
  const activeWaveId = readIfExists(markerPath);
  appendWaveInvalid(loop, iter, topic, "active_wave_exists", activeWaveId);
  return {
    reason: "parallel_wave_invalid",
    waveId: activeWaveId,
    elapsedMs: 0,
  };
}

function rejectPayload(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  reason: string,
): WaveResult {
  appendWaveInvalid(loop, iter, topic, reason, "");
  return { reason: "parallel_wave_invalid", waveId: "", elapsedMs: 0 };
}

function executeWaveWithObjectives(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  objectives: string[],
  markerPath: string,
): WaveResult {
  const waveId = generateCompactId("wave");
  const waveDir = join(loop.paths.stateDir, "waves", waveId);
  const branchesDir = join(waveDir, "branches");
  const openingRoles = iter.allowedRoles;
  const openingEvents = iter.allowedEvents;
  const waveStartMs = Date.now();

  mkdirSync(branchesDir, { recursive: true });
  writeFileSync(markerPath, waveId);
  writeWaveSpec(waveDir, waveId, emittedTopic, iter, objectives);
  appendWaveStart(loop, iter, waveId, emittedTopic, objectives);

  const specs = prepareParallelBranches(
    loop,
    iter,
    waveId,
    waveDir,
    emittedTopic,
    objectives,
  );
  const launched = launchParallelBranches(loop, specs);
  const results = joinParallelBranches(loop, iter, waveId, launched);
  const ordered = sortByBranchId(results);
  const totalElapsed = Date.now() - waveStartMs;

  writeWaveJoin(
    waveDir,
    waveId,
    emittedTopic,
    objectives,
    ordered,
    iter.recentEvent,
    openingRoles,
    openingEvents,
    totalElapsed,
  );
  appendWaveJoinStart(
    loop,
    iter,
    waveId,
    emittedTopic,
    objectives,
    ordered,
    totalElapsed,
  );
  try {
    unlinkSync(markerPath);
  } catch {
    /* ok */
  }

  const finalized = finalizeParallelWave(loop, iter, waveId, ordered);
  return { ...finalized, elapsedMs: totalElapsed };
}

function sortByBranchId(results: BranchResult[]): BranchResult[] {
  return [...results].sort(
    (a, b) => branchIndex(a.branchId) - branchIndex(b.branchId),
  );
}

function branchIndex(id: string): number {
  return parseInt(id.replace("branch-", ""), 10) || 0;
}

function writeWaveSpec(
  waveDir: string,
  waveId: string,
  emittedTopic: string,
  iter: IterationContext,
  objectives: string[],
): void {
  const content =
    md.heading(1, `Parallel Wave ${waveId}`) +
    "\n\n" +
    "Trigger: " +
    md.code(emittedTopic) +
    "\n" +
    "Opening recent event: " +
    md.code(iter.recentEvent) +
    "\n" +
    "Opening roles: " +
    iter.allowedRoles.join(", ") +
    "\n" +
    "Opening events: " +
    iter.allowedEvents.join(", ") +
    "\n\n" +
    md.heading(2, "Branch Objectives") +
    "\n" +
    md.bulletList(objectives);
  writeFileSync(join(waveDir, "spec.md"), content);
}

function writeWaveJoin(
  waveDir: string,
  waveId: string,
  emittedTopic: string,
  objectives: string[],
  results: BranchResult[],
  recentEvent: string,
  openingRoles: string[],
  openingEvents: string[],
  totalElapsed: number,
): void {
  const items = results.map(
    (r) => `${md.code(r.branchId)}: ${r.stopReason} (${r.elapsedMs}ms)`,
  );
  const content =
    md.heading(1, `Parallel Join ${waveId}`) +
    "\n\n" +
    "Trigger: " +
    md.code(emittedTopic) +
    "\n" +
    "Opening recent event: " +
    md.code(recentEvent) +
    "\n" +
    "Opening roles: " +
    openingRoles.join(", ") +
    "\n" +
    "Opening events: " +
    openingEvents.join(", ") +
    "\n" +
    "Total wave elapsed: " +
    md.code(`${totalElapsed}ms`) +
    "\n\n" +
    md.heading(2, "Objectives") +
    "\n" +
    md.bulletList(objectives) +
    "\n\n" +
    md.heading(2, "Branch Results") +
    "\n" +
    md.bulletList(items);
  writeFileSync(join(waveDir, "join.md"), content);
}

function activeWaveMarkerPath(loop: LoopContext): string {
  const wavesDir = join(loop.paths.stateDir, "waves");
  mkdirSync(wavesDir, { recursive: true });
  return join(wavesDir, "active");
}

function appendWaveInvalid(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  reason: string,
  activeWaveId: string,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.invalid",
    jsonField("trigger_topic", topic) +
      ", " +
      jsonField("reason", reason) +
      ", " +
      jsonField("active_wave_id", activeWaveId) +
      ", " +
      jsonField("opening_recent_event", iter.recentEvent),
  );
}

function appendWaveStart(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  emittedTopic: string,
  objectives: string[],
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.start",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("trigger_topic", emittedTopic) +
      ", " +
      jsonField("branch_count", String(objectives.length)) +
      ", " +
      jsonField("opening_recent_event", iter.recentEvent) +
      ", " +
      jsonField("opening_roles", joinCsv(iter.allowedRoles)) +
      ", " +
      jsonField("opening_events", joinCsv(iter.allowedEvents)) +
      ", " +
      jsonField("objectives", joinCsv(objectives)),
  );
}

function appendWaveJoinStart(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  emittedTopic: string,
  objectives: string[],
  results: BranchResult[],
  totalElapsed: number,
): void {
  const outcomes = results
    .map((r) => `${r.branchId}:${r.stopReason}`)
    .join(",");
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.join.start",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("trigger_topic", emittedTopic) +
      ", " +
      jsonField("branch_count", String(objectives.length)) +
      ", " +
      jsonField("elapsed_ms", String(totalElapsed)) +
      ", " +
      jsonField("branch_outcomes", outcomes),
  );
}
