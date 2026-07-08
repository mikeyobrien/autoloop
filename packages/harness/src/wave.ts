import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as md from "@mobrienv/autoloop-core";
import { generateCompactId, joinCsv, jsonField } from "@mobrienv/autoloop-core";
import { appendEvent, readIfExists } from "@mobrienv/autoloop-core/journal";
import type { Role } from "@mobrienv/autoloop-core/topology";
import type { IterationContext } from "./prompt.js";
import type { LoopContext } from "./types.js";
import { finalizeParallelWave } from "./wave/finalize-wave.js";
import {
  joinParallelBranches,
  launchParallelBranches,
  prepareParallelBranches,
} from "./wave/launch-branches.js";
import { parseParallelObjectives } from "./wave/parse-objectives.js";
import type {
  AggregateConfig,
  BranchResult,
  WaveResult,
  WaveSource,
} from "./wave/types.js";

export {
  continueAfterParallelJoin,
  stopAfterParallelWave,
} from "./wave/finalize-wave.js";
export type { AggregateConfig, WaveResult, WaveSource } from "./wave/types.js";

/** Registry key for the (single, backward-compatible) agent-triggered wave slot. */
export const AGENT_WAVE_KEY = "agent";

/** Registry key for a role's declarative wave slot. */
export function declarativeWaveKey(roleId: string): string {
  return `role:${roleId}`;
}

/**
 * Agent-triggered wave path (backward compatible): an agent emits a
 * `<role>.parallel`/`explore.parallel` topic; the payload lists branch
 * objectives. Tracked under the single `agent` registry slot, so a second
 * concurrent agent-triggered `.parallel` is still rejected as before —
 * independent of any declarative waves running for other roles.
 */
export function executeParallelWave(
  loop: LoopContext,
  iter: IterationContext,
  emittedTopic: string,
  emittedPayload: string,
): WaveResult {
  if (isWaveActive(loop, AGENT_WAVE_KEY)) {
    return rejectActiveWave(
      loop,
      iter,
      emittedTopic,
      AGENT_WAVE_KEY,
      "agent",
      undefined,
      undefined,
    );
  }

  const parsed = parseParallelObjectives(
    emittedPayload,
    loop.parallel.maxBranches,
  );
  if (!parsed.ok) {
    return rejectPayload(loop, iter, emittedTopic, parsed.reason, "agent");
  }

  return executeWaveWithObjectives(loop, iter, {
    key: AGENT_WAVE_KEY,
    emittedTopic,
    objectives: parsed.objectives,
    source: "agent",
    aggregate: loop.parallel.aggregate,
  });
}

/**
 * Declarative wave path (ralph v3 style): the harness auto-launches
 * `role.concurrency` identical branches for a role the just-emitted routing
 * event matched — no agent `.parallel` emit required. Tracked per-role, so
 * distinct roles' declarative waves (and the single agent-triggered slot) can
 * all be active at once.
 */
export function executeDeclarativeWave(
  loop: LoopContext,
  iter: IterationContext,
  role: Role,
  routingEvent: string,
): WaveResult {
  const key = declarativeWaveKey(role.id);
  const syntheticTopic = `${routingEvent}.parallel`;

  if (isWaveActive(loop, key)) {
    return rejectActiveWave(
      loop,
      iter,
      syntheticTopic,
      key,
      "declarative",
      role.id,
      role.concurrency,
    );
  }

  const count = Math.max(
    0,
    Math.min(role.concurrency ?? 0, loop.parallel.maxBranches),
  );
  if (count <= 0) {
    return rejectPayload(
      loop,
      iter,
      syntheticTopic,
      "empty_branch_list",
      "declarative",
    );
  }

  const objectives = declarativeObjectives(role, routingEvent, count);
  const aggregate: AggregateConfig = role.aggregate ?? loop.parallel.aggregate;

  return executeWaveWithObjectives(loop, iter, {
    key,
    emittedTopic: syntheticTopic,
    objectives,
    source: "declarative",
    roleId: role.id,
    concurrency: role.concurrency,
    aggregate,
  });
}

function declarativeObjectives(
  role: Role,
  routingEvent: string,
  count: number,
): string[] {
  const base =
    role.prompt.trim() ||
    `Act as role \`${role.id}\` in response to routing event \`${routingEvent}\`.`;
  const objectives: string[] = [];
  for (let i = 1; i <= count; i++) {
    objectives.push(`[branch ${i}/${count}] ${base}`);
  }
  return objectives;
}

function rejectActiveWave(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  key: string,
  source: WaveSource,
  roleId: string | undefined,
  concurrency: number | undefined,
): WaveResult {
  const activeWaveId = activeWaveId_(loop, key);
  appendWaveInvalid(
    loop,
    iter,
    topic,
    "active_wave_exists",
    activeWaveId,
    source,
    roleId,
    concurrency,
  );
  return {
    reason: "parallel_wave_invalid",
    waveId: activeWaveId,
    elapsedMs: 0,
    source,
  };
}

function rejectPayload(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  reason: string,
  source: WaveSource,
): WaveResult {
  appendWaveInvalid(
    loop,
    iter,
    topic,
    reason,
    "",
    source,
    undefined,
    undefined,
  );
  return { reason: "parallel_wave_invalid", waveId: "", elapsedMs: 0, source };
}

interface WaveOptions {
  key: string;
  emittedTopic: string;
  objectives: string[];
  source: WaveSource;
  roleId?: string;
  concurrency?: number;
  aggregate: AggregateConfig;
}

function executeWaveWithObjectives(
  loop: LoopContext,
  iter: IterationContext,
  options: WaveOptions,
): WaveResult {
  const {
    key,
    emittedTopic,
    objectives,
    source,
    roleId,
    concurrency,
    aggregate,
  } = options;
  const waveId = generateCompactId("wave");
  const waveDir = join(loop.paths.stateDir, "waves", waveId);
  const branchesDir = join(waveDir, "branches");
  const openingRoles = iter.allowedRoles;
  const openingEvents = iter.allowedEvents;
  const waveStartMs = Date.now();

  mkdirSync(branchesDir, { recursive: true });
  registerActiveWave(loop, key, waveId);
  writeWaveSpec(waveDir, waveId, emittedTopic, iter, objectives);
  appendWaveStart(
    loop,
    iter,
    waveId,
    emittedTopic,
    objectives,
    source,
    roleId,
    concurrency,
  );

  const specs = prepareParallelBranches(
    loop,
    iter,
    waveId,
    waveDir,
    emittedTopic,
    objectives,
  );
  const launched = launchParallelBranches(loop, specs);
  const { results, aggregateOutcome } = joinParallelBranches(
    loop,
    iter,
    waveId,
    launched,
    aggregate,
    waveStartMs,
  );
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
    source,
    roleId,
  );
  clearActiveWave(loop, key);

  const finalized = finalizeParallelWave(
    loop,
    iter,
    waveId,
    ordered,
    aggregate,
    aggregateOutcome,
  );
  return { ...finalized, elapsedMs: totalElapsed, source };
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

/* ── active-wave registry ──────────────────────────────────────────────────
 * Per-wave-id-indexed tracking: one small file per active wave key under
 * `waves/active/<sanitized-key>` (content = wave id), rather than a single
 * global `waves/active` marker file. This lets an agent-triggered wave and N
 * declarative role waves all be tracked as active simultaneously; only a
 * *second* wave under the *same* key is rejected.
 */

function activeWavesDir(loop: LoopContext): string {
  const wavesDir = join(loop.paths.stateDir, "waves");
  const legacyMarker = join(wavesDir, "active");
  // Migrate the old single-file marker format: if `waves/active` exists as a
  // FILE (pre-existing state dir from before this change), remove it so the
  // new directory can be created at the same path.
  if (existsSync(legacyMarker)) {
    try {
      if (statSync(legacyMarker).isFile()) unlinkSync(legacyMarker);
    } catch {
      /* ok */
    }
  }
  mkdirSync(legacyMarker, { recursive: true });
  return legacyMarker;
}

function sanitizeWaveKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function waveKeyPath(loop: LoopContext, key: string): string {
  return join(activeWavesDir(loop), sanitizeWaveKey(key));
}

/** Whether a wave is currently registered under `key` (agent slot or `role:<id>`). */
export function isWaveActive(loop: LoopContext, key: string): boolean {
  return existsSync(waveKeyPath(loop, key));
}

function activeWaveId_(loop: LoopContext, key: string): string {
  return readIfExists(waveKeyPath(loop, key));
}

/** Register a wave as active under `key` (test/registry-inspection hook). */
export function registerActiveWave(
  loop: LoopContext,
  key: string,
  waveId: string,
): void {
  writeFileSync(waveKeyPath(loop, key), waveId);
}

/** Clear the active-wave registration for `key`, if any. */
export function clearActiveWave(loop: LoopContext, key: string): void {
  try {
    unlinkSync(waveKeyPath(loop, key));
  } catch {
    /* ok */
  }
}

/** All currently-active waves (key, wave id) — declarative and agent-triggered. */
export function listActiveWaves(
  loop: LoopContext,
): Array<{ key: string; waveId: string }> {
  const dir = activeWavesDir(loop);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.map((key) => ({
    key,
    waveId: readIfExists(join(dir, key)),
  }));
}

function appendWaveInvalid(
  loop: LoopContext,
  iter: IterationContext,
  topic: string,
  reason: string,
  activeWaveId: string,
  source: WaveSource,
  roleId: string | undefined,
  concurrency: number | undefined,
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
      jsonField("opening_recent_event", iter.recentEvent) +
      ", " +
      jsonField("concurrency_source", source) +
      (roleId !== undefined ? `, ${jsonField("role_id", roleId)}` : "") +
      (concurrency !== undefined
        ? `, ${jsonField("concurrency", String(concurrency))}`
        : ""),
  );
}

function appendWaveStart(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  emittedTopic: string,
  objectives: string[],
  source: WaveSource,
  roleId: string | undefined,
  concurrency: number | undefined,
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
      jsonField("objectives", joinCsv(objectives)) +
      ", " +
      jsonField("concurrency_source", source) +
      (roleId !== undefined ? `, ${jsonField("role_id", roleId)}` : "") +
      (concurrency !== undefined
        ? `, ${jsonField("concurrency", String(concurrency))}`
        : ""),
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
  source: WaveSource,
  roleId: string | undefined,
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
      jsonField("branch_outcomes", outcomes) +
      ", " +
      jsonField("concurrency_source", source) +
      (roleId !== undefined ? `, ${jsonField("role_id", roleId)}` : ""),
  );
}
