import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import * as config from "../config.js";
import * as topo from "../topology.js";
import { splitCsv, generateCompactId } from "../utils.js";
import {
  readLines,
  readRunLines,
  extractTopic,
  extractField,
  extractIteration,
  latestRunId,
} from "./journal.js";
import { emitToolScript, piAdapterScript } from "./tools.js";
import type { LoopContext, RunOptions } from "./types.js";

export function resolvePrompt(projectDir: string, cfg: config.Config, override: string | null): string {
  if (override !== null) return override;
  const inlinePrompt = config.get(cfg, "event_loop.prompt", "");
  if (inlinePrompt) return inlinePrompt;
  const promptFile = config.get(cfg, "event_loop.prompt_file", "");
  if (promptFile) {
    const fullPath = join(projectDir, promptFile);
    if (existsSync(fullPath)) return readFileSync(fullPath, "utf-8");
  }
  return "Do the task and publish the completion event when finished.";
}

export function resolveReviewPrompt(projectDir: string, cfg: config.Config): string {
  const inlinePrompt = config.get(cfg, "review.prompt", "");
  if (inlinePrompt) return inlinePrompt;
  return readOptionalProjectFile(projectDir, config.get(cfg, "review.prompt_file", "metareview.md"));
}

export function readOptionalProjectFile(projectDir: string, relativePath: string): string {
  if (!relativePath) return "";
  const fullPath = join(projectDir, relativePath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf-8");
}

export function resolveReviewEvery(cfg: config.Config, topoData: topo.Topology): number {
  const configured = config.getInt(cfg, "review.every_iterations", 0);
  if (configured > 0) return configured;
  const count = topo.roleCount(topoData);
  return count > 0 ? count : 1;
}

export function truthySetting(value: string): boolean {
  return value !== "false" && value !== "0" && value !== "";
}

export function ensureLayout(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
}

export function installRuntimeTools(loop: LoopContext): void {
  writeFileSync(loop.paths.toolPath, emitToolScript(loop));
  chmodSync(loop.paths.toolPath, 0o755);
  writeFileSync(loop.paths.piAdapterPath, piAdapterScript(loop));
  chmodSync(loop.paths.piAdapterPath, 0o755);
}

export function resolveProcessKind(kind: string, command: string): string {
  if (kind === "pi") return "pi";
  if (kind === "command") return "command";
  return piBinary(command) ? "pi" : "command";
}

function piBinary(command: string): boolean {
  return command === "pi" || command.endsWith("/pi");
}

export function normalizePromptMode(value: string): string {
  return value === "stdin" ? "stdin" : "arg";
}

export function configListWithFallback(cfg: config.Config, key: string, fallback: string[]): string[] {
  const marker = "__missing__";
  const raw = config.get(cfg, key, marker);
  if (raw === marker) return fallback;
  return splitCsv(raw);
}

export function processStringOverride(override: Record<string, unknown>, key: string, fallback: string): string {
  const val = override[key];
  return typeof val === "string" ? val : fallback;
}

export function processListOverride(override: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const val = override[key];
  return Array.isArray(val) ? val as string[] : fallback;
}

export function nextRunId(path: string, cfg: config.Config): string {
  if (config.get(cfg, "core.run_id_format", "compact") === "counter") {
    const lines = readLines(path);
    const count = lines.filter((l) => extractTopic(l) === "loop.start").length;
    return "run-" + (count + 1);
  }
  return generateCompactId("run");
}

export function iterationFieldForRun(
  journalFile: string,
  runId: string,
  iteration: string,
  topic: string,
  field: string,
): string {
  const lines = readRunLines(journalFile, runId);
  let current = "";
  for (const line of lines) {
    if (extractTopic(line) === topic && extractIteration(line) === iteration) {
      current = extractField(line, field);
    }
  }
  return current;
}

export function ensureRenderRunId(journalFile: string): string {
  return process.env["MINILOOPS_RUN_ID"] || latestRunId(journalFile);
}

export function absolutePath(path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(process.cwd(), path);
}

export function emptyFallback(text: string): string {
  return text || "(empty)";
}

export function buildLoopContext(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): LoopContext {
  const resolvedProjectDir = absolutePath(projectDir);
  const resolvedWorkDir = absolutePath(runOptions.workDir || ".");
  const cfg = config.loadProject(resolvedProjectDir);
  const stateDir = join(resolvedWorkDir, config.get(cfg, "core.state_dir", ".miniloop"));
  const journalFile = config.resolveJournalFileIn(resolvedProjectDir, resolvedWorkDir);
  const memoryFile = config.resolveMemoryFileIn(resolvedProjectDir, resolvedWorkDir);
  const runId = nextRunId(journalFile, cfg);
  const backendOverride = runOptions.backendOverride || {};
  const cliLogLevel = runOptions.logLevel ?? null;
  const configLogLevel = config.get(cfg, "core.log_level", "info");
  const logLevel = cliLogLevel || configLogLevel;

  const loop: LoopContext = {
    objective: "",
    topology: topo.loadTopology(resolvedProjectDir),
    limits: { maxIterations: 0 },
    completion: { promise: "", event: "", requiredEvents: [] },
    backend: { kind: "", command: "", args: [], promptMode: "arg", timeoutMs: 300000 },
    review: { enabled: true, every: 1, kind: "", command: "", args: [], promptMode: "arg", prompt: "", timeoutMs: 300000 },
    parallel: { enabled: false, maxBranches: 3, branchTimeoutMs: 180000 },
    memory: { budgetChars: 8000 },
    harness: { instructions: "" },
    paths: {
      projectDir: resolvedProjectDir,
      workDir: resolvedWorkDir,
      stateDir,
      journalFile,
      memoryFile,
      toolPath: join(stateDir, "autoloops"),
      piAdapterPath: join(stateDir, "pi-adapter"),
    },
    runtime: {
      runId,
      selfCommand,
      promptOverride: promptOverride ?? null,
      backendOverride,
      logLevel,
      branchMode: false,
    },
    store: {},
  };
  return reloadLoop(loop);
}

export function reloadLoop(loop: LoopContext): LoopContext {
  const pd = loop.paths.projectDir;
  const cfg = config.loadProject(pd);
  const topoData = topo.loadTopology(pd);
  const bo = loop.runtime.backendOverride;

  const backendCommand = processStringOverride(bo, "command", config.get(cfg, "backend.command", "pi"));
  const backendKind = resolveProcessKind(processStringOverride(bo, "kind", config.get(cfg, "backend.kind", "")), backendCommand);
  const backendArgs = processListOverride(bo, "args", configListWithFallback(cfg, "backend.args", []));
  const backendPromptMode = normalizePromptMode(processStringOverride(bo, "prompt_mode", config.get(cfg, "backend.prompt_mode", "arg")));
  const maxIterations = config.getInt(cfg, "event_loop.max_iterations", 3);
  const completionPromise = config.get(cfg, "event_loop.completion_promise", "LOOP_COMPLETE");
  const completionEvent = topo.completionEvent(topoData, config.get(cfg, "event_loop.completion_event", "task.complete"));
  const requiredEvents = config.getList(cfg, "event_loop.required_events");
  const objective = resolvePrompt(pd, cfg, loop.runtime.promptOverride);
  const parallelEnabled = truthySetting(config.get(cfg, "parallel.enabled", "false"));
  const parallelMaxBranches = config.getInt(cfg, "parallel.max_branches", 3);
  const parallelBranchTimeoutMs = config.getInt(cfg, "parallel.branch_timeout_ms", 180000);
  const memoryBudgetChars = config.getInt(cfg, "memory.prompt_budget_chars", 8000);
  const reviewEvery = resolveReviewEvery(cfg, topoData);
  const reviewEnabled = truthySetting(config.get(cfg, "review.enabled", "true"));
  const backendTimeoutMs = config.getInt(cfg, "backend.timeout_ms", 300000);
  const reviewTimeoutMs = config.getInt(cfg, "review.timeout_ms", 300000);
  const reviewCommand = config.get(cfg, "review.command", backendCommand);
  const reviewKind = resolveProcessKind(config.get(cfg, "review.kind", backendKind), reviewCommand);
  const reviewArgs = configListWithFallback(cfg, "review.args", backendArgs);
  const reviewPromptMode = normalizePromptMode(config.get(cfg, "review.prompt_mode", backendPromptMode));
  const harnessText = readOptionalProjectFile(pd, config.get(cfg, "harness.instructions_file", "harness.md"));
  const reviewText = resolveReviewPrompt(pd, cfg);

  const updated: LoopContext = {
    objective,
    topology: topoData,
    limits: { maxIterations },
    completion: { promise: completionPromise, event: completionEvent, requiredEvents },
    backend: { kind: backendKind, command: backendCommand, args: backendArgs, promptMode: backendPromptMode, timeoutMs: backendTimeoutMs },
    review: { enabled: reviewEnabled, every: reviewEvery, kind: reviewKind, command: reviewCommand, args: reviewArgs, promptMode: reviewPromptMode, prompt: reviewText, timeoutMs: reviewTimeoutMs },
    parallel: { enabled: parallelEnabled, maxBranches: parallelMaxBranches, branchTimeoutMs: parallelBranchTimeoutMs },
    memory: { budgetChars: memoryBudgetChars },
    harness: { instructions: harnessText },
    paths: loop.paths,
    runtime: loop.runtime,
    store: loop.store,
  };
  return applyRuntimeModeOverrides(updated);
}

export function applyRuntimeModeOverrides(loop: LoopContext): LoopContext {
  if (!loop.runtime.branchMode) return loop;
  return {
    ...loop,
    limits: { maxIterations: 1 },
    review: { ...loop.review, enabled: false },
    parallel: { ...loop.parallel, enabled: false },
    backend: { ...loop.backend, timeoutMs: Math.min(loop.backend.timeoutMs, loop.parallel.branchTimeoutMs) },
  };
}

export function initStore(loop: LoopContext): LoopContext {
  return {
    ...loop,
    store: {
      run_id: loop.runtime.runId,
      project_dir: loop.paths.projectDir,
      self_command: loop.runtime.selfCommand,
      max_iterations: loop.limits.maxIterations,
      completion_event: loop.completion.event,
      completion_promise: loop.completion.promise,
    },
  };
}
