import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonField, jsonFieldRaw, jsonBool } from "../json.js";
import { joinCsv, splitCsv, listText, shellQuote } from "../utils.js";
import { extractField, readIfExists, appendAgentEvent, appendEvent } from "./journal.js";
import type { LoopContext } from "./types.js";
import { buildBackendShellCommand, normalizeBackendLabel, runBackendCommand } from "../backend/index.js";
import type { IterationContext } from "./prompt.js";

export interface BranchLaunch {
  branchId: string;
  objective: string;
  emittedTopic: string;
  routingEvent: string;
  allowedRoles: string[];
  allowedEvents: string[];
  prompt: string;
  backendKind: string;
  backendCommand: string;
  backendArgs: string[];
  backendPromptMode: string;
  logLevel: string;
}

export function loadParallelBranchLaunch(branchDir: string): BranchLaunch {
  const line = readIfExists(join(branchDir, "launch.json"));
  return {
    branchId: extractField(line, "branch_id"),
    objective: extractField(line, "objective"),
    emittedTopic: extractField(line, "emitted_topic"),
    routingEvent: extractField(line, "routing_event"),
    allowedRoles: csvFieldList(line, "allowed_roles"),
    allowedEvents: csvFieldList(line, "allowed_events"),
    prompt: extractField(line, "prompt"),
    backendKind: extractField(line, "backend_kind"),
    backendCommand: extractField(line, "backend_command"),
    backendArgs: csvFieldList(line, "backend_args"),
    backendPromptMode: extractField(line, "backend_prompt_mode"),
    logLevel: extractField(line, "log_level"),
  };
}

export function csvFieldList(line: string, field: string): string[] {
  const value = extractField(line, field);
  if (!value) return [];
  return splitCsv(value);
}

export function parallelBranchBackendOverride(launch: BranchLaunch): Record<string, unknown> {
  const override: Record<string, unknown> = {};
  if (launch.backendKind) override["kind"] = launch.backendKind;
  if (launch.backendCommand) override["command"] = launch.backendCommand;
  if (launch.backendArgs.length > 0) override["args"] = launch.backendArgs;
  if (launch.backendPromptMode) override["prompt_mode"] = launch.backendPromptMode;
  return override;
}

export function writeParallelBranchSummary(branchDir: string, result: Record<string, unknown>): void {
  const fields =
    jsonField("branch_id", String(result["branch_id"] ?? "")) + ", " +
    jsonField("objective", String(result["objective"] ?? "")) + ", " +
    jsonField("stop_reason", String(result["stop_reason"] ?? "unknown")) + ", " +
    jsonField("output", String(result["output"] ?? "")) + ", " +
    jsonField("routing_event", String(result["routing_event"] ?? "")) + ", " +
    jsonField("allowed_roles", joinCsv((result["allowed_roles"] ?? []) as string[])) + ", " +
    jsonField("allowed_events", joinCsv((result["allowed_events"] ?? []) as string[])) + ", " +
    jsonField("elapsed_ms", String(result["elapsed_ms"] ?? 0)) + ", " +
    jsonField("finished_at_ms", String(result["finished_at_ms"] ?? 0));
  writeFileSync(join(branchDir, "summary.json"), "{" + fields + "}\n");
}

export function renderBranchResult(result: Record<string, unknown>): string {
  return (
    "# Branch Result\n\n" +
    "Stop reason: `" + (result["stop_reason"] ?? "unknown") + "`\n" +
    "Elapsed: `" + (result["elapsed_ms"] ?? 0) + "ms`\n" +
    "Routing event: `" + (result["routing_event"] ?? "") + "`\n" +
    "Allowed events: " + listText((result["allowed_events"] ?? []) as string[]) + "\n\n" +
    "## Output\n\n" + (result["output"] ?? "") + "\n"
  );
}

export function seedBranchContext(loop: LoopContext, routingEvent: string): LoopContext {
  if (routingEvent === "loop.start") return loop;
  appendAgentEvent(loop.paths.journalFile, loop.runtime.runId, "", routingEvent, "branch routing seed");
  return loop;
}

export function branchStopReason(stopReason: string, elapsedMs: number, timeoutMs: number): string {
  if (stopReason === "backend_timeout") return "backend_timeout";
  return elapsedMs > timeoutMs ? "backend_timeout" : stopReason;
}

// --- Process execution ---

export interface ProcessResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

export function runProcess(command: string, timeoutMs: number, providerKind = "command"): ProcessResult {
  const result = runBackendCommand(providerKind, command, timeoutMs);
  return {
    output: result.output,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
}

export function buildBackendCommand(loop: LoopContext, iter: IterationContext): string {
  return buildBackendShellCommand({
    loop,
    spec: loop.backend,
    prompt: iter.prompt,
    runtimeEnv: runtimeEnvLines(loop, String(iter.iteration), iter.recentEvent, joinCsv(iter.allowedRoles), joinCsv(iter.allowedEvents), ""),
  });
}

export function buildReviewCommand(loop: LoopContext, iteration: number, reviewPrompt: string): string {
  return buildBackendShellCommand({
    loop,
    spec: loop.review,
    prompt: reviewPrompt,
    runtimeEnv: runtimeEnvLines(loop, String(iteration), "loop.start", "review", "__metareview_disabled__", "metareview"),
  });
}

export function runtimeEnvLines(
  loop: LoopContext,
  iteration: string,
  recentEvent: string,
  allowedRoles: string,
  allowedEvents: string,
  reviewMode: string,
): string {
  let lines =
    "export MINILOOPS_RUN_ID=" + shellQuote(loop.runtime.runId) + "\n" +
    "export MINILOOPS_ITERATION=" + shellQuote(iteration) + "\n";
  if (reviewMode) {
    lines += "export MINILOOPS_REVIEW_MODE=" + shellQuote(reviewMode) + "\n";
  }
  lines +=
    "export MINILOOPS_LOG_LEVEL=" + shellQuote(loop.runtime.logLevel) + "\n" +
    "export MINILOOPS_COMPLETION_PROMISE=" + shellQuote(loop.completion.promise) + "\n" +
    "export MINILOOPS_COMPLETION_EVENT=" + shellQuote(loop.completion.event) + "\n" +
    "export MINILOOPS_STATE_DIR=" + shellQuote(loop.paths.stateDir) + "\n" +
    "export MINILOOPS_PROJECT_DIR=" + shellQuote(loop.paths.projectDir) + "\n" +
    "export MINILOOPS_JOURNAL_FILE=" + shellQuote(loop.paths.journalFile) + "\n" +
    "export MINILOOPS_EVENTS_FILE=" + shellQuote(loop.paths.journalFile) + "\n" +
    "export MINILOOPS_MEMORY_FILE=" + shellQuote(loop.paths.memoryFile) + "\n" +
    "export MINILOOPS_REQUIRED_EVENTS=" + shellQuote(joinCsv(loop.completion.requiredEvents)) + "\n" +
    "export MINILOOPS_RECENT_EVENT=" + shellQuote(recentEvent) + "\n" +
    "export MINILOOPS_ALLOWED_ROLES=" + shellQuote(allowedRoles) + "\n" +
    "export MINILOOPS_ALLOWED_EVENTS=" + shellQuote(allowedEvents) + "\n" +
    "export MINILOOPS_BIN=" + shellQuote(loop.paths.toolPath) + "\n";
  return lines;
}

// --- Journal append helpers ---

export function appendLoopStart(loop: LoopContext): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    "",
    "loop.start",
    jsonField("max_iterations", String(loop.limits.maxIterations)) +
      ", " + jsonField("completion_promise", loop.completion.promise) +
      ", " + jsonField("completion_event", loop.completion.event) +
      ", " + jsonField("review_every", String(loop.review.every)) +
      ", " + jsonField("objective", loop.objective) +
      ", " + jsonField("preset", loop.launch.preset) +
      ", " + jsonField("trigger", loop.launch.trigger) +
      ", " + jsonField("created_at", loop.launch.createdAt) +
      ", " + jsonField("project_dir", loop.paths.projectDir) +
      ", " + jsonField("work_dir", loop.paths.workDir) +
      ", " + jsonField("backend", normalizeBackendLabel(loop.backend.command)) +
      ", " + jsonField("parent_run_id", loop.launch.parentRunId),
  );
}

export function appendIterationStart(loop: LoopContext, iter: IterationContext): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "iteration.start",
    jsonField("recent_event", iter.recentEvent) +
      ", " + jsonField("suggested_roles", joinCsv(iter.allowedRoles)) +
      ", " + jsonField("allowed_events", joinCsv(iter.allowedEvents)) +
      ", " + jsonField("backpressure", iter.backpressure) +
      ", " + jsonField("prompt", iter.prompt),
  );
}

export function appendBackendStart(loop: LoopContext, iter: IterationContext): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "backend.start",
    jsonField("backend_kind", loop.backend.kind) +
      ", " + jsonField("command", loop.backend.command) +
      ", " + jsonField("prompt_mode", loop.backend.promptMode) +
      ", " + jsonField("timeout_ms", String(loop.backend.timeoutMs)),
  );
}

export function appendBackendFinish(
  loop: LoopContext,
  iter: IterationContext,
  output: string,
  exitCode: number,
  timedOut: boolean,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "backend.finish",
    jsonField("exit_code", String(exitCode)) +
      ", " + jsonFieldRaw("timed_out", jsonBool(timedOut)) +
      ", " + jsonField("output", output),
  );
}

export function appendIterationFinish(
  loop: LoopContext,
  iter: IterationContext,
  output: string,
  exitCode: number,
  timedOut: boolean,
  elapsedS: number,
): void {
  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iter.iteration),
    "iteration.finish",
    jsonField("exit_code", String(exitCode)) +
      ", " + jsonFieldRaw("timed_out", jsonBool(timedOut)) +
      ", " + jsonField("elapsed_s", String(elapsedS)) +
      ", " + jsonField("output", output),
  );
}
