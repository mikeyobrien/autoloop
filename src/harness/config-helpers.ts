import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import * as config from "../config.js";
import * as topo from "../topology.js";
import * as profiles from "../profiles.js";
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
import { resolveIsolationMode } from "../isolation/resolve.js";
import { createRunScopedDir, runScopedPath } from "../isolation/run-scope.js";
import { activeRuns } from "../registry/read.js";
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

export function injectClaudePermissions(command: string, args: string[]): string[] {
  if (!claudeBackend(command)) return args;
  const injected = [...args];
  if (!injected.includes("-p")) injected.unshift("-p");
  if (!injected.includes("--dangerously-skip-permissions")) {
    injected.push("--dangerously-skip-permissions");
  }
  return injected;
}

export function processStringOverride(override: Record<string, unknown>, key: string, fallback: string): string {
  const val = override[key];
  return typeof val === "string" ? val : fallback;
}

export function processListOverride(override: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const val = override[key];
  return Array.isArray(val) ? val as string[] : fallback;
}

function claudeBackend(command: string): boolean {
  return command === "claude" || command.endsWith("/claude");
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

  // Resolve isolation mode
  const registryFile = join(stateDir, "registry.jsonl");
  const otherActive = activeRuns(registryFile);
  const configIsolationEnabled = config.get(cfg, "isolation.enabled", "false") === "true";
  const isolation = resolveIsolationMode(
    { worktree: runOptions.worktree, noWorktree: runOptions.noWorktree, configEnabled: configIsolationEnabled },
    otherActive,
  );
  if (isolation.warning) {
    process.stderr.write("isolation: " + isolation.warning + "\n");
  }

  // For run-scoped isolation, route per-run state files to runs/<runId>/
  const effectiveStateDir = isolation.mode === "run-scoped"
    ? createRunScopedDir(stateDir, runId)
    : stateDir;

  // Compute active profiles: config defaults (unless suppressed) + CLI explicit
  const cliProfiles = runOptions.profiles ?? [];
  const noDefaults = runOptions.noDefaultProfiles ?? false;
  const configDefaults = noDefaults ? [] : config.getProfileDefaults(cfg);
  const activeProfiles = [...configDefaults, ...cliProfiles];

  // Only paths, runtime, launch, profiles, and store survive — reloadLoop fills the rest from config.
  const seed = {
    paths: {
      projectDir: resolvedProjectDir,
      workDir: resolvedWorkDir,
      stateDir: effectiveStateDir,
      journalFile: isolation.mode === "run-scoped" ? join(effectiveStateDir, "journal.jsonl") : journalFile,
      memoryFile,
      registryFile,
      toolPath: join(effectiveStateDir, "autoloops"),
      piAdapterPath: join(effectiveStateDir, "pi-adapter"),
      baseStateDir: stateDir,
      mainProjectDir: resolvedProjectDir,
    },
    runtime: {
      runId,
      selfCommand,
      promptOverride: promptOverride ?? null,
      backendOverride,
      logLevel,
      branchMode: false,
      isolationMode: isolation.mode,
    },
    launch: {
      preset: basename(resolvedProjectDir),
      trigger: runOptions.trigger ?? "cli",
      createdAt: new Date().toISOString(),
      parentRunId: runOptions.parentRunId ?? "",
    },
    profiles: { active: activeProfiles, fragments: new Map<string, string>(), warnings: [] as string[] },
    store: {},
  } as unknown as LoopContext;
  return reloadLoop(seed);
}

export function reloadLoop(loop: LoopContext): LoopContext {
  const pd = loop.paths.projectDir;
  const wd = loop.paths.workDir;
  const cfg = config.loadProject(pd);
  const topoData = topo.loadTopology(pd);

  const backend = readBackendConfig(cfg, loop.runtime.backendOverride);
  const review = readReviewConfig(cfg, topoData, pd, backend);
  const parallel = readParallelConfig(cfg);

  // Resolve and apply profile fragments
  const activeProfiles = loop.profiles?.active ?? [];
  let profileInfo = loop.profiles ?? { active: [], fragments: new Map(), warnings: [] };
  let finalTopology = topoData;
  if (activeProfiles.length > 0) {
    const presetName = loop.launch.preset;
    const resolved = profiles.resolveProfileFragments(activeProfiles, presetName, topoData.roles, wd);
    profileInfo = { active: activeProfiles, fragments: resolved.fragments, warnings: resolved.warnings };
    finalTopology = { ...topoData, roles: profiles.applyProfileFragments(topoData.roles, resolved.fragments) };
    for (const w of resolved.warnings) {
      process.stderr.write("profile warning: " + w + "\n");
    }
  }

  const updated: LoopContext = {
    objective: resolvePrompt(pd, cfg, loop.runtime.promptOverride),
    topology: finalTopology,
    limits: { maxIterations: config.getInt(cfg, "event_loop.max_iterations", 3) },
    completion: {
      promise: config.get(cfg, "event_loop.completion_promise", "LOOP_COMPLETE"),
      event: topo.completionEvent(topoData, config.get(cfg, "event_loop.completion_event", "task.complete")),
      requiredEvents: config.getList(cfg, "event_loop.required_events"),
    },
    backend,
    review,
    parallel,
    memory: { budgetChars: config.getInt(cfg, "memory.prompt_budget_chars", 8000) },
    harness: { instructions: readOptionalProjectFile(pd, config.get(cfg, "harness.instructions_file", "harness.md")) },
    profiles: profileInfo,
    paths: loop.paths,
    runtime: loop.runtime,
    launch: loop.launch,
    store: loop.store,
  };
  return applyRuntimeModeOverrides(updated);
}

function readBackendConfig(
  cfg: config.Config,
  bo: Record<string, unknown>,
): LoopContext["backend"] {
  const command = processStringOverride(bo, "command", config.get(cfg, "backend.command", "pi"));
  const kind = resolveProcessKind(processStringOverride(bo, "kind", config.get(cfg, "backend.kind", "")), command);
  const args = injectClaudePermissions(
    command,
    processListOverride(bo, "args", configListWithFallback(cfg, "backend.args", [])),
  );
  const promptMode = normalizePromptMode(processStringOverride(bo, "prompt_mode", config.get(cfg, "backend.prompt_mode", "arg")));
  const timeoutMs = config.getInt(cfg, "backend.timeout_ms", 300000);
  return { kind, command, args, promptMode, timeoutMs };
}

function readReviewConfig(
  cfg: config.Config,
  topoData: topo.Topology,
  projectDir: string,
  backend: LoopContext["backend"],
): LoopContext["review"] {
  const command = config.get(cfg, "review.command", backend.command);
  const kind = resolveProcessKind(config.get(cfg, "review.kind", backend.kind), command);
  return {
    enabled: truthySetting(config.get(cfg, "review.enabled", "true")),
    every: resolveReviewEvery(cfg, topoData),
    kind,
    command,
    args: configListWithFallback(cfg, "review.args", backend.args),
    promptMode: normalizePromptMode(config.get(cfg, "review.prompt_mode", backend.promptMode)),
    prompt: resolveReviewPrompt(projectDir, cfg),
    timeoutMs: config.getInt(cfg, "review.timeout_ms", 300000),
  };
}

function readParallelConfig(cfg: config.Config): LoopContext["parallel"] {
  return {
    enabled: truthySetting(config.get(cfg, "parallel.enabled", "false")),
    maxBranches: config.getInt(cfg, "parallel.max_branches", 3),
    branchTimeoutMs: config.getInt(cfg, "parallel.branch_timeout_ms", 180000),
  };
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
