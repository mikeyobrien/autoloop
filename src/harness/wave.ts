import { writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { jsonField } from "../json.js";
import { joinCsv, listText, generateCompactId, replaceAll, lineSep, shellQuote } from "../utils.js";
import * as md from "../markdown.js";
import * as topology from "../topology.js";
import { extractField, readIfExists, appendEvent, appendHarnessEvent } from "./journal.js";
import { parallelDispatchBase, parallelJoinedTopic } from "./emit.js";
import {
  runProcess,
  writeParallelBranchSummary,
  renderBranchResult,
} from "./parallel.js";
import type { LoopContext, RunSummary } from "./types.js";
import type { IterationContext } from "./prompt.js";

export interface WaveResult {
  reason: string;
  waveId: string;
  elapsedMs: number;
}

interface BranchSpec {
  branchId: string;
  waveId: string;
  objective: string;
  emittedTopic: string;
  routingEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  prompt: string;
  branchDir: string;
  launchFile: string;
  summaryFile: string;
  stdoutFile: string;
  stderrFile: string;
  statusFile: string;
  pidFile: string;
  supervisorFile: string;
  launchMs: number;
}

interface BranchResult {
  branchId: string;
  objective: string;
  stopReason: string;
  output: string;
  routingEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  branchDir: string;
  elapsedMs: number;
  finishedAtMs: number;
}

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

  const parsed = parseParallelObjectives(emittedPayload, loop.parallel.maxBranches);
  if (!parsed.ok) {
    return rejectPayload(loop, iter, emittedTopic, parsed.reason);
  }

  return executeWaveWithObjectives(loop, iter, emittedTopic, parsed.objectives, markerPath);
}

function rejectActiveWave(loop: LoopContext, iter: IterationContext, topic: string, markerPath: string): WaveResult {
  const activeWaveId = readIfExists(markerPath);
  appendWaveInvalid(loop, iter, topic, "active_wave_exists", activeWaveId);
  return { reason: "parallel_wave_invalid", waveId: activeWaveId, elapsedMs: 0 };
}

function rejectPayload(loop: LoopContext, iter: IterationContext, topic: string, reason: string): WaveResult {
  appendWaveInvalid(loop, iter, topic, reason, "");
  return { reason: "parallel_wave_invalid", waveId: "", elapsedMs: 0 };
}

function executeWaveWithObjectives(
  loop: LoopContext, iter: IterationContext, emittedTopic: string,
  objectives: string[], markerPath: string,
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

  const specs = prepareParallelBranches(loop, iter, waveId, waveDir, emittedTopic, objectives);
  const launched = launchParallelBranches(loop, specs);
  const results = joinParallelBranches(loop, iter, waveId, launched);
  const ordered = sortByBranchId(results);
  const totalElapsed = Date.now() - waveStartMs;

  writeWaveJoin(waveDir, waveId, emittedTopic, objectives, ordered, iter.recentEvent, openingRoles, openingEvents, totalElapsed);
  appendWaveJoinStart(loop, iter, waveId, emittedTopic, objectives, ordered, totalElapsed);
  try { unlinkSync(markerPath); } catch { /* ok */ }

  const finalized = finalizeParallelWave(loop, iter, waveId, ordered);
  return { ...finalized, elapsedMs: totalElapsed };
}

// --- Objective Parsing ---

interface ParseResult { ok: boolean; objectives: string[]; reason: string }

function parseParallelObjectives(payload: string, maxBranches: number): ParseResult {
  const lines = payload.split(lineSep()).map(l => l.trim()).filter(l => l !== "");
  const objectives: string[] = [];
  let invalid = false;

  for (const line of lines) {
    const obj = parseObjectiveLine(line);
    if (obj === "") { invalid = true; } else { objectives.push(obj); }
  }

  if (invalid) return { ok: false, objectives: [], reason: "invalid_branch_list" };
  if (objectives.length === 0) return { ok: false, objectives: [], reason: "empty_branch_list" };
  if (objectives.length > maxBranches) return { ok: false, objectives: [], reason: "too_many_branches" };
  return { ok: true, objectives, reason: "" };
}

function parseObjectiveLine(line: string): string {
  if (line.startsWith("- ") || line.startsWith("* ")) return line.slice(2).trim();
  const dotIdx = line.indexOf(". ");
  if (dotIdx > 0 && /^\d+$/.test(line.slice(0, dotIdx))) return line.slice(dotIdx + 2).trim();
  return "";
}

// --- Branch Preparation ---

function prepareParallelBranches(
  loop: LoopContext, iter: IterationContext, waveId: string,
  waveDir: string, emittedTopic: string, objectives: string[],
): BranchSpec[] {
  return objectives.map((objective, i) => {
    const branchId = `branch-${i + 1}`;
    const branchDir = join(waveDir, "branches", branchId);
    const routingEvent = branchRoutingEvent(iter, emittedTopic);
    const branchRoles = topology.suggestedRoles(loop.topology, routingEvent);
    const branchEvents = topology.allowedEvents(loop.topology, routingEvent);
    const prompt = renderBranchPrompt(loop, objective, emittedTopic, routingEvent, branchRoles, branchEvents);

    const spec: BranchSpec = {
      branchId, waveId, objective, emittedTopic, routingEvent,
      allowedRoles: branchRoles, allowedEvents: branchEvents, prompt,
      branchDir,
      launchFile: join(branchDir, "launch.json"),
      summaryFile: join(branchDir, "summary.json"),
      stdoutFile: join(branchDir, "stdout.log"),
      stderrFile: join(branchDir, "stderr.log"),
      statusFile: join(branchDir, "status.txt"),
      pidFile: join(branchDir, "pid.txt"),
      supervisorFile: join(branchDir, "supervisor.sh"),
      launchMs: 0,
    };

    mkdirSync(branchDir, { recursive: true });
    writeFileSync(join(branchDir, "objective.md"), renderBranchObjective(objective, emittedTopic, routingEvent, branchRoles, branchEvents));
    writeBranchLaunch(spec, loop, branchRoles, branchEvents);
    appendWaveBranchStart(loop, iter, waveId, branchId, objective, routingEvent, branchRoles, branchEvents);
    return spec;
  });
}

function writeBranchLaunch(spec: BranchSpec, loop: LoopContext, _roles: string[], _events: string[]): void {
  const fields =
    jsonField("branch_id", spec.branchId) + ", " +
    jsonField("objective", spec.objective) + ", " +
    jsonField("emitted_topic", spec.emittedTopic) + ", " +
    jsonField("routing_event", spec.routingEvent) + ", " +
    jsonField("allowed_roles", joinCsv(spec.allowedRoles)) + ", " +
    jsonField("allowed_events", joinCsv(spec.allowedEvents)) + ", " +
    jsonField("prompt", spec.prompt) + ", " +
    jsonField("backend_kind", loop.backend.kind) + ", " +
    jsonField("backend_command", loop.backend.command) + ", " +
    jsonField("backend_args", joinCsv(loop.backend.args)) + ", " +
    jsonField("backend_prompt_mode", loop.backend.promptMode) + ", " +
    jsonField("log_level", loop.runtime.logLevel);
  writeFileSync(spec.launchFile, "{" + fields + "}\n");
}

// --- Branch Launch ---

function launchParallelBranches(loop: LoopContext, specs: BranchSpec[]): BranchSpec[] {
  return specs.map(spec => launchBranch(loop, spec));
}

function launchBranch(loop: LoopContext, spec: BranchSpec): BranchSpec {
  const launchMs = Date.now();
  writeSupervisor(loop, spec);
  const cmd =
    `rm -f ${shellQuote(spec.stdoutFile)} ${shellQuote(spec.stderrFile)} ${shellQuote(spec.statusFile)} ${shellQuote(spec.pidFile)} ; ` +
    `nohup sh ${shellQuote(spec.supervisorFile)} >/dev/null 2>&1 & printf '%s' "$!" > ${shellQuote(spec.pidFile)}`;

  runProcess(cmd, 10000);
  const launched = { ...spec, launchMs };
  const pid = readIfExists(spec.pidFile).trim();
  if (!pid) {
    recordLaunchFailure(launched);
  }
  return launched;
}

function writeSupervisor(loop: LoopContext, spec: BranchSpec): void {
  const cmd = loop.runtime.selfCommand + " branch-run " + shellQuote(loop.paths.projectDir) + " " + shellQuote(spec.branchDir);
  const content =
    "#!/bin/sh\nset -eu\nchild=''\n" +
    "cleanup() {\n  if [ -n \"$child\" ]; then\n    kill \"$child\" 2>/dev/null || true\n    wait \"$child\" 2>/dev/null || true\n  fi\n  exit 130\n}\n" +
    "trap cleanup INT TERM\n" +
    cmd + " >" + shellQuote(spec.stdoutFile) + " 2>" + shellQuote(spec.stderrFile) + " &\n" +
    "child=$!\nwait \"$child\"\nstatus=$?\n" +
    "printf '%s' \"$status\" > " + shellQuote(spec.statusFile) + "\n";
  writeFileSync(spec.supervisorFile, content);
  try { chmodSync(spec.supervisorFile, 0o755); } catch { /* */ }
}

function recordLaunchFailure(spec: BranchSpec): void {
  const finishedMs = Date.now();
  const result = branchResultFromSpec(spec, "branch_process_failed", `branch launch failed for \`${spec.branchId}\``, finishedMs - spec.launchMs, finishedMs);
  writeFileSync(spec.statusFile, "1");
  writeFileSync(join(spec.branchDir, "result.md"), renderBranchResult({ ...result, branch_dir: spec.branchDir }));
  writeParallelBranchSummary(spec.branchDir, { ...result, branch_dir: spec.branchDir });
}

// --- Branch Join (poll loop) ---

function joinParallelBranches(loop: LoopContext, iter: IterationContext, waveId: string, pending: BranchSpec[]): BranchResult[] {
  const results: BranchResult[] = [];
  let remaining = [...pending];

  while (remaining.length > 0) {
    const ready: BranchResult[] = [];
    const stillPending: BranchSpec[] = [];

    for (const spec of remaining) {
      const polled = pollBranch(loop, spec);
      if (polled) { ready.push(polled); } else { stillPending.push(spec); }
    }

    if (ready.length > 0) {
      for (const r of sortByFinishedAt(ready)) {
        appendWaveBranchFinish(loop, iter, waveId, r.branchId, r);
        results.push(r);
      }
    }

    remaining = stillPending;
    if (remaining.length > 0 && ready.length === 0) {
      try { execSync("sleep 0.1"); } catch { /* */ }
    }
  }
  return results;
}

function pollBranch(loop: LoopContext, spec: BranchSpec): BranchResult | null {
  if (existsSync(spec.summaryFile)) return loadSummaryResult(spec);
  if (existsSync(spec.statusFile)) return ensureBranchResult(spec, "branch_process_failed");
  if (Date.now() - spec.launchMs > loop.parallel.branchTimeoutMs) {
    terminateBranch(spec);
    return ensureBranchResult(spec, "backend_timeout");
  }
  return null;
}

function loadSummaryResult(spec: BranchSpec): BranchResult {
  const line = readIfExists(spec.summaryFile);
  return {
    branchId: extractField(line, "branch_id"),
    objective: extractField(line, "objective"),
    stopReason: extractField(line, "stop_reason"),
    output: extractField(line, "output"),
    routingEvent: extractField(line, "routing_event"),
    allowedRoles: csvList(line, "allowed_roles"),
    allowedEvents: csvList(line, "allowed_events"),
    branchDir: spec.branchDir,
    elapsedMs: parseInt(extractField(line, "elapsed_ms")) || 0,
    finishedAtMs: parseInt(extractField(line, "finished_at_ms")) || 0,
  };
}

function ensureBranchResult(spec: BranchSpec, fallbackReason: string): BranchResult {
  if (existsSync(spec.summaryFile)) return loadSummaryResult(spec);
  const finishedMs = Date.now();
  const output = combinedOutput(spec);
  const result = branchResultFromSpec(spec, fallbackReason, output, finishedMs - spec.launchMs, finishedMs);
  writeFileSync(join(spec.branchDir, "result.md"), renderBranchResult({ ...result, branch_dir: spec.branchDir }));
  writeParallelBranchSummary(spec.branchDir, { ...result, branch_dir: spec.branchDir });
  return result;
}

function terminateBranch(spec: BranchSpec): void {
  const pid = readIfExists(spec.pidFile).trim();
  if (pid) { try { runProcess(`kill ${shellQuote(pid)} 2>/dev/null || true`, 5000); } catch { /* */ } }
}

function combinedOutput(spec: BranchSpec): string {
  const stdout = readIfExists(spec.stdoutFile).trim();
  const stderr = readIfExists(spec.stderrFile).trim();
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return stdout + "\n\nstderr:\n" + stderr;
}

function csvList(line: string, field: string): string[] {
  const v = extractField(line, field);
  return v ? v.split(",").map(s => s.trim()).filter(s => s !== "") : [];
}

function branchResultFromSpec(spec: BranchSpec, stopReason: string, output: string, elapsedMs: number, finishedAtMs: number): BranchResult {
  return { branchId: spec.branchId, objective: spec.objective, stopReason, output, routingEvent: spec.routingEvent, allowedRoles: spec.allowedRoles, allowedEvents: spec.allowedEvents, branchDir: spec.branchDir, elapsedMs, finishedAtMs };
}

// --- Wave Finalization ---

function finalizeParallelWave(loop: LoopContext, iter: IterationContext, waveId: string, results: BranchResult[]): { reason: string; waveId: string } {
  const timedOut = results.filter(r => r.stopReason === "backend_timeout").map(r => r.branchId);
  if (timedOut.length > 0) {
    appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.timeout", jsonField("wave_id", waveId) + ", " + jsonField("timed_out_branches", joinCsv(timedOut)));
    return { reason: "parallel_wave_timeout", waveId };
  }
  const failed = results.filter(r => !branchSuccessStatus(r.stopReason)).map(r => r.branchId);
  if (failed.length > 0) {
    appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.failed", jsonField("wave_id", waveId) + ", " + jsonField("failed_branches", joinCsv(failed)));
    return { reason: "parallel_wave_failed", waveId };
  }
  return { reason: "parallel_wave_complete", waveId };
}

function branchSuccessStatus(status: string): boolean {
  return status === "max_iterations" || status === "completion_event" || status === "completion_promise";
}

// --- Continue / Stop after wave ---

export function continueAfterParallelJoin(
  loop: LoopContext, iter: IterationContext, waveId: string, emittedTopic: string, totalElapsedMs: number,
  iterateFn: (loop: LoopContext, iteration: number) => RunSummary,
): RunSummary {
  const joinedTopic = parallelJoinedTopic(emittedTopic);
  appendWaveJoinFinish(loop, iter, waveId, emittedTopic, joinedTopic, totalElapsedMs);
  appendHarnessEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), joinedTopic, waveId);
  return iterateFn(loop, iter.iteration + 1);
}

export function stopAfterParallelWave(loop: LoopContext, iter: IterationContext, reason: string, waveId: string): RunSummary {
  const fields = jsonField("reason", reason) + ", " + jsonField("iteration", String(iter.iteration)) + (waveId ? ", " + jsonField("wave_id", waveId) : "");
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "loop.stop", fields);
  return { iterations: iter.iteration, stopReason: reason };
}

// --- Sorting ---

function sortByBranchId(results: BranchResult[]): BranchResult[] {
  return [...results].sort((a, b) => branchIndex(a.branchId) - branchIndex(b.branchId));
}

function sortByFinishedAt(results: BranchResult[]): BranchResult[] {
  return [...results].sort((a, b) => {
    if (a.finishedAtMs !== b.finishedAtMs) return a.finishedAtMs - b.finishedAtMs;
    return branchIndex(a.branchId) - branchIndex(b.branchId);
  });
}

function branchIndex(id: string): number {
  return parseInt(replaceAll(id, "branch-", "")) || 0;
}

// --- Routing helpers ---

function branchRoutingEvent(iter: IterationContext, emittedTopic: string): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return parallelDispatchBase(emittedTopic) || iter.recentEvent;
}

function joinedResumeRoutingBasis(iter: IterationContext, emittedTopic: string): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return parallelDispatchBase(emittedTopic) || iter.recentEvent;
}

function joinedResumeRecentEvent(iter: IterationContext, emittedTopic: string, joinedTopic: string): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return joinedTopic;
}

function joinedResumeRoles(loop: LoopContext, iter: IterationContext, emittedTopic: string, routingBasis: string): string[] {
  if (emittedTopic === "explore.parallel") return iter.allowedRoles;
  return topology.suggestedRoles(loop.topology, routingBasis);
}

function joinedResumeEvents(loop: LoopContext, iter: IterationContext, emittedTopic: string, routingBasis: string): string[] {
  if (emittedTopic === "explore.parallel") return iter.allowedEvents;
  return topology.allowedEvents(loop.topology, routingBasis);
}

// --- Markdown Rendering ---

function renderBranchPrompt(loop: LoopContext, objective: string, emittedTopic: string, routingEvent: string, roles: string[], events: string[]): string {
  return "Parallel branch objective:\n" + objective + "\n\n" +
    "Parent objective:\n" + loop.objective + "\n\n" +
    "Wave trigger: " + md.code(emittedTopic) + "\n" +
    "Branch routing event: " + md.code(routingEvent) + "\n" +
    "Suggested roles: " + listText(roles) + "\n" +
    "Allowed events: " + listText(events) + "\n" +
    "Work only on this branch objective. Branch state is isolated; do not assume you can control parent routing directly.\n";
}

function renderBranchObjective(objective: string, emittedTopic: string, routingEvent: string, roles: string[], events: string[]): string {
  return md.heading(1, "Branch Objective") + "\n\n" +
    "Trigger: " + md.code(emittedTopic) + "\n" +
    "Routing event: " + md.code(routingEvent) + "\n" +
    "Roles: " + listText(roles) + "\n" +
    "Allowed events: " + listText(events) + "\n\n" +
    objective + "\n";
}

function writeWaveSpec(waveDir: string, waveId: string, emittedTopic: string, iter: IterationContext, objectives: string[]): void {
  const content = md.heading(1, "Parallel Wave " + waveId) + "\n\n" +
    "Trigger: " + md.code(emittedTopic) + "\n" +
    "Opening recent event: " + md.code(iter.recentEvent) + "\n" +
    "Opening roles: " + listText(iter.allowedRoles) + "\n" +
    "Opening events: " + listText(iter.allowedEvents) + "\n\n" +
    md.heading(2, "Branch Objectives") + "\n" + md.bulletList(objectives);
  writeFileSync(join(waveDir, "spec.md"), content);
}

function writeWaveJoin(
  waveDir: string, waveId: string, emittedTopic: string, objectives: string[],
  results: BranchResult[], recentEvent: string, openingRoles: string[], openingEvents: string[], totalElapsed: number,
): void {
  const items = results.map(r => md.code(r.branchId) + ": " + r.stopReason + " (" + r.elapsedMs + "ms)");
  const content = md.heading(1, "Parallel Join " + waveId) + "\n\n" +
    "Trigger: " + md.code(emittedTopic) + "\n" +
    "Opening recent event: " + md.code(recentEvent) + "\n" +
    "Opening roles: " + listText(openingRoles) + "\n" +
    "Opening events: " + listText(openingEvents) + "\n" +
    "Total wave elapsed: " + md.code(totalElapsed + "ms") + "\n\n" +
    md.heading(2, "Objectives") + "\n" + md.bulletList(objectives) + "\n\n" +
    md.heading(2, "Branch Results") + "\n" + md.bulletList(items);
  writeFileSync(join(waveDir, "join.md"), content);
}

// --- Journal Append Helpers ---

function activeWaveMarkerPath(loop: LoopContext): string {
  const wavesDir = join(loop.paths.stateDir, "waves");
  mkdirSync(wavesDir, { recursive: true });
  return join(wavesDir, "active");
}

function appendWaveInvalid(loop: LoopContext, iter: IterationContext, topic: string, reason: string, activeWaveId: string): void {
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.invalid",
    jsonField("trigger_topic", topic) + ", " + jsonField("reason", reason) + ", " + jsonField("active_wave_id", activeWaveId) + ", " + jsonField("opening_recent_event", iter.recentEvent));
}

function appendWaveStart(loop: LoopContext, iter: IterationContext, waveId: string, emittedTopic: string, objectives: string[]): void {
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.start",
    jsonField("wave_id", waveId) + ", " + jsonField("trigger_topic", emittedTopic) + ", " + jsonField("branch_count", String(objectives.length)) + ", " + jsonField("opening_recent_event", iter.recentEvent) + ", " + jsonField("opening_roles", joinCsv(iter.allowedRoles)) + ", " + jsonField("opening_events", joinCsv(iter.allowedEvents)) + ", " + jsonField("objectives", joinCsv(objectives)));
}

function appendWaveBranchStart(loop: LoopContext, iter: IterationContext, waveId: string, branchId: string, objective: string, routingEvent: string, roles: string[], events: string[]): void {
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.branch.start",
    jsonField("wave_id", waveId) + ", " + jsonField("branch_id", branchId) + ", " + jsonField("objective", objective) + ", " + jsonField("routing_event", routingEvent) + ", " + jsonField("branch_roles", joinCsv(roles)) + ", " + jsonField("branch_events", joinCsv(events)));
}

function appendWaveBranchFinish(loop: LoopContext, iter: IterationContext, waveId: string, branchId: string, result: BranchResult): void {
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.branch.finish",
    jsonField("wave_id", waveId) + ", " + jsonField("branch_id", branchId) + ", " + jsonField("stop_reason", result.stopReason) + ", " + jsonField("elapsed_ms", String(result.elapsedMs)) + ", " + jsonField("output", result.output));
}

function appendWaveJoinStart(loop: LoopContext, iter: IterationContext, waveId: string, emittedTopic: string, objectives: string[], results: BranchResult[], totalElapsed: number): void {
  const outcomes = results.map(r => r.branchId + ":" + r.stopReason).join(",");
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.join.start",
    jsonField("wave_id", waveId) + ", " + jsonField("trigger_topic", emittedTopic) + ", " + jsonField("branch_count", String(objectives.length)) + ", " + jsonField("elapsed_ms", String(totalElapsed)) + ", " + jsonField("branch_outcomes", outcomes));
}

function appendWaveJoinFinish(loop: LoopContext, iter: IterationContext, waveId: string, emittedTopic: string, joinedTopic: string, totalElapsed: number): void {
  const routingBasis = joinedResumeRoutingBasis(iter, emittedTopic);
  const resumeRecentEvent = joinedResumeRecentEvent(iter, emittedTopic, joinedTopic);
  const resumeRoles = joinedResumeRoles(loop, iter, emittedTopic, routingBasis);
  const resumeEvents = joinedResumeEvents(loop, iter, emittedTopic, routingBasis);
  appendEvent(loop.paths.journalFile, loop.runtime.runId, String(iter.iteration), "wave.join.finish",
    jsonField("wave_id", waveId) + ", " + jsonField("trigger_topic", emittedTopic) + ", " + jsonField("joined_topic", joinedTopic) + ", " + jsonField("routing_basis", routingBasis) + ", " + jsonField("resume_recent_event", resumeRecentEvent) + ", " + jsonField("resume_roles", joinCsv(resumeRoles)) + ", " + jsonField("resume_events", joinCsv(resumeEvents)) + ", " + jsonField("elapsed_ms", String(totalElapsed)));
}
