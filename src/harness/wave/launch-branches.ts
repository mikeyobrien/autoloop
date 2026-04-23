import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as md from "@mobrienv/autoloop-core";
import {
  joinCsv,
  jsonField,
  listText,
  shellQuote,
} from "@mobrienv/autoloop-core";
import {
  appendEvent,
  extractField,
  readIfExists,
} from "@mobrienv/autoloop-core/journal";
import * as topology from "@mobrienv/autoloop-core/topology";
import { parallelDispatchBase } from "../emit.js";
import {
  renderBranchResult,
  runProcess,
  writeParallelBranchSummary,
} from "../parallel.js";
import type { IterationContext } from "../prompt.js";
import type { LoopContext } from "../types.js";
import type { BranchResult, BranchSpec } from "./types.js";

export function prepareParallelBranches(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  waveDir: string,
  emittedTopic: string,
  objectives: string[],
): BranchSpec[] {
  return objectives.map((objective, i) => {
    const branchId = `branch-${i + 1}`;
    const branchDir = join(waveDir, "branches", branchId);
    const routingEvent = branchRoutingEvent(iter, emittedTopic);
    const branchRoles = topology.suggestedRoles(loop.topology, routingEvent);
    const branchEvents = topology.allowedEvents(loop.topology, routingEvent);
    const prompt = renderBranchPrompt(
      loop,
      objective,
      emittedTopic,
      routingEvent,
      branchRoles,
      branchEvents,
    );

    const spec: BranchSpec = {
      branchId,
      waveId,
      objective,
      emittedTopic,
      routingEvent,
      allowedRoles: branchRoles,
      allowedEvents: branchEvents,
      prompt,
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
    writeFileSync(
      join(branchDir, "objective.md"),
      renderBranchObjective(
        objective,
        emittedTopic,
        routingEvent,
        branchRoles,
        branchEvents,
      ),
    );
    writeBranchLaunch(spec, loop);
    appendWaveBranchStart(
      loop,
      iter,
      waveId,
      branchId,
      objective,
      routingEvent,
      branchRoles,
      branchEvents,
    );
    return spec;
  });
}

export function launchParallelBranches(
  loop: LoopContext,
  specs: BranchSpec[],
): BranchSpec[] {
  return specs.map((spec) => launchBranch(loop, spec));
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
  if (!pid) recordLaunchFailure(launched);
  return launched;
}

export function joinParallelBranches(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  pending: BranchSpec[],
): BranchResult[] {
  const results: BranchResult[] = [];
  let remaining = [...pending];

  while (remaining.length > 0) {
    const ready: BranchResult[] = [];
    const stillPending: BranchSpec[] = [];

    for (const spec of remaining) {
      const polled = pollBranch(loop, spec);
      if (polled) ready.push(polled);
      else stillPending.push(spec);
    }

    if (ready.length > 0) {
      for (const r of sortByFinishedAt(ready)) {
        appendWaveBranchFinish(loop, iter, waveId, r.branchId, r);
        results.push(r);
      }
    }

    remaining = stillPending;
    if (remaining.length > 0 && ready.length === 0) {
      try {
        execSync("sleep 0.1");
      } catch {
        /* */
      }
    }
  }
  return results;
}

function writeBranchLaunch(spec: BranchSpec, loop: LoopContext): void {
  const fields =
    jsonField("branch_id", spec.branchId) +
    ", " +
    jsonField("objective", spec.objective) +
    ", " +
    jsonField("emitted_topic", spec.emittedTopic) +
    ", " +
    jsonField("routing_event", spec.routingEvent) +
    ", " +
    jsonField("allowed_roles", joinCsv(spec.allowedRoles)) +
    ", " +
    jsonField("allowed_events", joinCsv(spec.allowedEvents)) +
    ", " +
    jsonField("prompt", spec.prompt) +
    ", " +
    jsonField("backend_kind", loop.backend.kind) +
    ", " +
    jsonField("backend_command", loop.backend.command) +
    ", " +
    jsonField("backend_args", joinCsv(loop.backend.args)) +
    ", " +
    jsonField("backend_prompt_mode", loop.backend.promptMode) +
    ", " +
    jsonField("log_level", loop.runtime.logLevel);
  writeFileSync(spec.launchFile, `{${fields}}\n`);
}

function writeSupervisor(loop: LoopContext, spec: BranchSpec): void {
  const cmd =
    loop.runtime.selfCommand +
    " branch-run " +
    shellQuote(loop.paths.projectDir) +
    " " +
    shellQuote(spec.branchDir);
  const content =
    "#!/bin/sh\nset -eu\nchild=''\n" +
    'cleanup() {\n  if [ -n "$child" ]; then\n    kill "$child" 2>/dev/null || true\n    wait "$child" 2>/dev/null || true\n  fi\n  exit 130\n}\n' +
    "trap cleanup INT TERM\n" +
    cmd +
    " >" +
    shellQuote(spec.stdoutFile) +
    " 2>" +
    shellQuote(spec.stderrFile) +
    " &\n" +
    'child=$!\nwait "$child"\nstatus=$?\n' +
    "printf '%s' \"$status\" > " +
    shellQuote(spec.statusFile) +
    "\n";
  writeFileSync(spec.supervisorFile, content);
  try {
    chmodSync(spec.supervisorFile, 0o755);
  } catch {
    /* */
  }
}

function recordLaunchFailure(spec: BranchSpec): void {
  const finishedMs = Date.now();
  const result = branchResultFromSpec(
    spec,
    "branch_process_failed",
    `branch launch failed for \`${spec.branchId}\``,
    finishedMs - spec.launchMs,
    finishedMs,
  );
  writeFileSync(spec.statusFile, "1");
  writeFileSync(
    join(spec.branchDir, "result.md"),
    renderBranchResult({ ...result, branch_dir: spec.branchDir }),
  );
  writeParallelBranchSummary(spec.branchDir, {
    ...result,
    branch_dir: spec.branchDir,
  });
}

function pollBranch(loop: LoopContext, spec: BranchSpec): BranchResult | null {
  if (existsSync(spec.summaryFile)) return loadSummaryResult(spec);
  if (existsSync(spec.statusFile))
    return ensureBranchResult(spec, "branch_process_failed");
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
    elapsedMs: parseInt(extractField(line, "elapsed_ms"), 10) || 0,
    finishedAtMs: parseInt(extractField(line, "finished_at_ms"), 10) || 0,
  };
}

function ensureBranchResult(
  spec: BranchSpec,
  fallbackReason: string,
): BranchResult {
  if (existsSync(spec.summaryFile)) return loadSummaryResult(spec);
  const finishedMs = Date.now();
  const output = combinedOutput(spec);
  const result = branchResultFromSpec(
    spec,
    fallbackReason,
    output,
    finishedMs - spec.launchMs,
    finishedMs,
  );
  writeFileSync(
    join(spec.branchDir, "result.md"),
    renderBranchResult({ ...result, branch_dir: spec.branchDir }),
  );
  writeParallelBranchSummary(spec.branchDir, {
    ...result,
    branch_dir: spec.branchDir,
  });
  return result;
}

function terminateBranch(spec: BranchSpec): void {
  const pid = readIfExists(spec.pidFile).trim();
  if (pid) {
    try {
      runProcess(`kill ${shellQuote(pid)} 2>/dev/null || true`, 5000);
    } catch {
      /* */
    }
  }
}

function combinedOutput(spec: BranchSpec): string {
  const stdout = readIfExists(spec.stdoutFile).trim();
  const stderr = readIfExists(spec.stderrFile).trim();
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return `${stdout}\n\nstderr:\n${stderr}`;
}

function csvList(line: string, field: string): string[] {
  const v = extractField(line, field);
  return v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    : [];
}

function branchResultFromSpec(
  spec: BranchSpec,
  stopReason: string,
  output: string,
  elapsedMs: number,
  finishedAtMs: number,
): BranchResult {
  return {
    branchId: spec.branchId,
    objective: spec.objective,
    stopReason,
    output,
    routingEvent: spec.routingEvent,
    allowedRoles: spec.allowedRoles,
    allowedEvents: spec.allowedEvents,
    branchDir: spec.branchDir,
    elapsedMs,
    finishedAtMs,
  };
}

function sortByFinishedAt(results: BranchResult[]): BranchResult[] {
  return [...results].sort((a, b) => {
    if (a.finishedAtMs !== b.finishedAtMs)
      return a.finishedAtMs - b.finishedAtMs;
    return branchIndex(a.branchId) - branchIndex(b.branchId);
  });
}

function branchIndex(id: string): number {
  return parseInt(id.replace("branch-", ""), 10) || 0;
}

function branchRoutingEvent(
  iter: IterationContext,
  emittedTopic: string,
): string {
  if (emittedTopic === "explore.parallel") return iter.recentEvent;
  return parallelDispatchBase(emittedTopic) || iter.recentEvent;
}

function renderBranchPrompt(
  loop: LoopContext,
  objective: string,
  emittedTopic: string,
  routingEvent: string,
  roles: string[],
  events: string[],
): string {
  return (
    "Parallel branch objective:\n" +
    objective +
    "\n\n" +
    "Parent objective:\n" +
    loop.objective +
    "\n\n" +
    "Wave trigger: " +
    md.code(emittedTopic) +
    "\n" +
    "Branch routing event: " +
    md.code(routingEvent) +
    "\n" +
    "Suggested roles: " +
    listText(roles) +
    "\n" +
    "Allowed events: " +
    listText(events) +
    "\n" +
    "Work only on this branch objective. Branch state is isolated; do not assume you can control parent routing directly.\n"
  );
}

function renderBranchObjective(
  objective: string,
  emittedTopic: string,
  routingEvent: string,
  roles: string[],
  events: string[],
): string {
  return (
    md.heading(1, "Branch Objective") +
    "\n\n" +
    "Trigger: " +
    md.code(emittedTopic) +
    "\n" +
    "Routing event: " +
    md.code(routingEvent) +
    "\n" +
    "Roles: " +
    listText(roles) +
    "\n" +
    "Allowed events: " +
    listText(events) +
    "\n\n" +
    objective +
    "\n"
  );
}

function appendWaveBranchStart(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  branchId: string,
  objective: string,
  routingEvent: string,
  roles: string[],
  events: string[],
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.branch.start",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("branch_id", branchId) +
      ", " +
      jsonField("objective", objective) +
      ", " +
      jsonField("routing_event", routingEvent) +
      ", " +
      jsonField("branch_roles", joinCsv(roles)) +
      ", " +
      jsonField("branch_events", joinCsv(events)),
  );
}

function appendWaveBranchFinish(
  loop: LoopContext,
  iter: IterationContext,
  waveId: string,
  branchId: string,
  result: BranchResult,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "wave.branch.finish",
    jsonField("wave_id", waveId) +
      ", " +
      jsonField("branch_id", branchId) +
      ", " +
      jsonField("stop_reason", result.stopReason) +
      ", " +
      jsonField("elapsed_ms", String(result.elapsedMs)) +
      ", " +
      jsonField("output", result.output),
  );
}
