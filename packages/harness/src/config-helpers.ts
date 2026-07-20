import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  isAcpBackendKind,
  resolveAcpProvider,
} from "@mobrienv/autoloop-backends/acp-providers";
import {
  assertNoRawAutoloopPaths,
  expandTemplatePlaceholders,
  generateCompactId,
  generateReadableId,
  splitCsv,
  uniqueGeneratedId,
} from "@mobrienv/autoloop-core";
import { loadAgentMap } from "@mobrienv/autoloop-core/agent-map";
import * as concurrency from "@mobrienv/autoloop-core/concurrency";
import * as config from "@mobrienv/autoloop-core/config";
import type { HookSpec } from "@mobrienv/autoloop-core/hooks-schema";
import {
  presetCategory,
  resolveIsolationMode,
} from "@mobrienv/autoloop-core/isolation/resolve";
import { createRunScopedDir } from "@mobrienv/autoloop-core/isolation/run-scope";
import {
  extractField,
  extractIteration,
  extractTopic,
  latestRunId,
  readLines,
  readRunLines,
  resolveRunJournalPath,
} from "@mobrienv/autoloop-core/journal";
import * as profiles from "@mobrienv/autoloop-core/profiles";
import { activeRuns } from "@mobrienv/autoloop-core/registry/read";
import * as topo from "@mobrienv/autoloop-core/topology";
import {
  createWorktree,
  resolveGitRoot,
  tryResolveGitRoot,
} from "@mobrienv/autoloop-core/worktree";
import { emitToolScript, piAdapterScript } from "./tools.js";
import type { LoopContext, ReviewOnError, RunOptions } from "./types.js";

const DEFAULT_PROMPT =
  "Do the task and publish the completion event when finished.";
const VALID_PROCESS_KINDS = [
  "command",
  "pi",
  "claude-sdk",
  "acp",
  "kiro",
  "hermes",
] as const;

export interface ResolvePromptOptions {
  workDir?: string;
  stateDir?: string;
  baseStateDir?: string;
}

export function resolvePrompt(
  projectDir: string,
  cfg: config.Config,
  override: string | null,
  options: ResolvePromptOptions = {},
): string {
  if (override !== null) return override;
  const inlinePrompt = config.get(cfg, "event_loop.prompt", "");
  if (inlinePrompt) return inlinePrompt;
  const promptFile = config.get(cfg, "event_loop.prompt_file", "");
  if (promptFile) {
    const fullPath = join(projectDir, promptFile);
    if (existsSync(fullPath)) return readFileSync(fullPath, "utf-8");
  }
  if (!existingPlanFile(options)) {
    const promptDir =
      tryResolveGitRoot(options.workDir ?? projectDir) ??
      options.workDir ??
      projectDir;
    const rootPrompt = join(promptDir, "PROMPT.md");
    if (existsSync(rootPrompt)) return readFileSync(rootPrompt, "utf-8");
  }
  return DEFAULT_PROMPT;
}

function existingPlanFile(options: ResolvePromptOptions): boolean {
  const dirs = [options.stateDir, options.baseStateDir].filter(
    (dir): dir is string => Boolean(dir),
  );
  return dirs.some((dir) => existsSync(join(dir, "plan.md")));
}

export function resolveReviewPrompt(
  projectDir: string,
  cfg: config.Config,
): string {
  const inlinePrompt = config.get(cfg, "review.prompt", "");
  if (inlinePrompt) return inlinePrompt;
  return readOptionalProjectFile(
    projectDir,
    config.get(cfg, "review.prompt_file", "metareview.md"),
  );
}

export function readOptionalProjectFile(
  projectDir: string,
  relativePath: string,
): string {
  if (!relativePath) return "";
  const fullPath = join(projectDir, relativePath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf-8");
}

export function resolveReviewEvery(
  cfg: config.Config,
  topoData: topo.Topology,
): number {
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

export function resolveProcessKind(
  kind: string,
  command: string,
  opts?: { hasCustomArgs?: boolean; roleId?: string },
): string {
  if (
    kind !== "" &&
    kind !== "command" &&
    kind !== "pi" &&
    kind !== "claude-sdk" &&
    !isAcpBackendKind(kind)
  ) {
    const roleContext = opts?.roleId
      ? ` for role ${JSON.stringify(opts.roleId)}`
      : "";
    throw new Error(
      `Unrecognized backend kind ${JSON.stringify(kind)}${roleContext}. Valid kinds: ${VALID_PROCESS_KINDS.join(", ")}. (Empty/unset means auto-detect.)`,
    );
  }
  if (kind === "pi" || piBinary(command)) return "pi";
  if (kind === "claude-sdk") return "claude-sdk";
  if (isAcpBackendKind(kind)) return "acp";
  // Hermes ACP: `hermes acp` is a native ACP provider like pi. Map it to the
  // ACP session path so providerLaunchArgs injects --profile correctly.
  if (hermesBinary(command)) return "acp";
  // Default: a plain `claude` invocation runs through the Agent SDK session
  // backend (live interrupt/steer + cost telemetry). Custom args mean the
  // user is tailoring the CLI invocation — respect it and keep the shell
  // path, as does an explicit `kind = "command"`.
  if (kind === "" && claudeBackend(command) && !opts?.hasCustomArgs) {
    return "claude-sdk";
  }
  return "command";
}

function piBinary(command: string): boolean {
  return command === "pi" || command.endsWith("/pi");
}

function hermesBinary(command: string): boolean {
  const base = command.split("/").pop() ?? "";
  return base === "hermes";
}

export function normalizePromptMode(value: string): string {
  if (value === "stdin") return "stdin";
  if (value === "file") return "file";
  if (value === "acp") return "acp";
  return "arg";
}

export function configListWithFallback(
  cfg: config.Config,
  key: string,
  fallback: string[],
): string[] {
  const marker = "__missing__";
  const raw = config.get(cfg, key, marker);
  if (raw === marker) return fallback;
  return splitCsv(raw);
}

export function injectClaudePermissions(
  command: string,
  args: string[],
): string[] {
  if (!claudeBackend(command)) return args;
  const injected = [...args];
  if (!injected.includes("-p")) injected.unshift("-p");
  if (!injected.includes("--dangerously-skip-permissions")) {
    injected.push("--dangerously-skip-permissions");
  }
  return injected;
}

export function processStringOverride(
  override: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const val = override[key];
  return typeof val === "string" ? val : fallback;
}

export function processListOverride(
  override: Record<string, unknown>,
  key: string,
  fallback: string[],
): string[] {
  const val = override[key];
  return Array.isArray(val) ? (val as string[]) : fallback;
}

export function processIntOverride(
  override: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const val = override[key];
  if (val !== undefined) {
    if (typeof val !== "number" || !Number.isInteger(val)) {
      throw new Error(
        `backend override "${key}" must be an integer, got ${
          typeof val === "number" ? val : typeof val
        }`,
      );
    }
    return val;
  }
  return fallback;
}

export function processBoolOverride(
  override: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const val = override[key];
  if (val === undefined) return fallback;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val !== "false";
  return fallback;
}

export function claudeBackend(command: string): boolean {
  return command === "claude" || command.endsWith("/claude");
}

export function nextRunId(path: string, cfg: config.Config): string {
  const lines = readLines(path);
  const format = config.get(cfg, "core.run_id_format", "human");
  if (format === "counter") {
    const count = lines.filter((l) => extractTopic(l) === "loop.start").length;
    return `run-${count + 1}`;
  }
  const existing = new Set(
    lines.map((line) => extractField(line, "run")).filter(Boolean),
  );
  if (format === "compact") {
    return (
      uniqueGeneratedId(() => generateCompactId("run"), existing) ??
      generateCompactId("run")
    );
  }
  return (
    uniqueGeneratedId(generateReadableId, existing) ?? generateCompactId("run")
  );
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
  return process.env.AUTOLOOP_RUN_ID || latestRunId(journalFile);
}

export function absolutePath(path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(process.cwd(), path);
}

export function emptyFallback(text: string): string {
  return text || "(empty)";
}

/**
 * Resolve the journal file path for a specific run.
 * Delegates to resolveRunJournalPath for run-scoped/worktree paths,
 * falling back to the top-level journal.
 */
export function resolveJournalFileForRun(
  projectDir: string,
  runId: string,
): { journalFile: string; runId: string } {
  const stateDir = config.stateDirPath(projectDir);
  const resolved = resolveRunJournalPath(
    stateDir,
    runId,
    config.stateDirName(projectDir),
  );
  const journalFile = resolved ?? config.resolveJournalFile(projectDir);
  return { journalFile, runId };
}

export function buildLoopContext(
  projectDir: string,
  promptOverride: string | null,
  selfCommand: string,
  runOptions: RunOptions,
): LoopContext {
  const resolvedProjectDir = absolutePath(projectDir);
  const resolvedWorkDir = absolutePath(runOptions.workDir || ".");
  const presetFile = runOptions.presetFile
    ? absolutePath(runOptions.presetFile)
    : "";
  const currentPresetName = presetFile
    ? basename(presetFile, ".toml")
    : basename(resolvedProjectDir);
  const configWorkDir = tryResolveGitRoot(resolvedWorkDir) ?? resolvedWorkDir;
  const configOverride = runOptions.configOverride || {};
  const loadOptions = {
    presetName: currentPresetName,
    workDir: configWorkDir,
    cliOverride: configOverride,
  };
  const cfg = presetFile
    ? config.loadProjectFromFile(presetFile, loadOptions)
    : config.loadProject(resolvedProjectDir, loadOptions);
  const stateDirAnchor = configWorkDir;
  const stateDirRel = config.stateDirRel(cfg);
  const stateDir = join(stateDirAnchor, stateDirRel);
  const journalRelPath = config.journalPath(cfg);
  const journalFile = join(resolvedWorkDir, journalRelPath);
  const memoryFile = join(resolvedWorkDir, config.memoryPath(cfg));
  // tasksFile is resolved later, after isolation mode determines effectiveStateDir
  const runId = nextRunId(journalFile, cfg);
  const backendOverride = runOptions.backendOverride || {};
  const logLevel =
    runOptions.logLevel || config.get(cfg, "core.log_level", "info");

  // Resolve isolation mode
  const registryFile = join(stateDir, "registry.jsonl");
  const otherActive = activeRuns(registryFile);
  const configIsolationEnabled =
    config.get(cfg, "worktree.enabled", "") === "true" ||
    config.get(cfg, "isolation.enabled", "false") === "true";
  const currentCat = presetCategory(currentPresetName, resolvedProjectDir);
  const isolation = resolveIsolationMode(
    {
      worktree: runOptions.worktree,
      noWorktree: runOptions.noWorktree,
      configEnabled: configIsolationEnabled,
      currentCategory: currentCat,
    },
    otherActive,
  );
  if (isolation.warning) {
    process.stderr.write(`\n${isolation.warning}\n\n`);
  }

  // For run-scoped isolation, route per-run state files to runs/<runId>/
  let effectiveStateDir =
    isolation.mode === "run-scoped"
      ? createRunScopedDir(stateDir, runId)
      : stateDir;

  // Worktree mode: create git worktree and redirect workDir + stateDir
  let effectiveWorkDir = resolvedWorkDir;
  let worktreeBranch = "";
  let worktreePath = "";
  let worktreeMetaDir = "";

  if (isolation.mode === "worktree") {
    const gitRoot = resolveGitRoot(resolvedWorkDir);
    const branchPrefix = config.get(cfg, "worktree.branch_prefix", "autoloop");
    const mergeStrategy =
      runOptions.mergeStrategy ||
      config.get(cfg, "worktree.merge_strategy", "squash");
    const wt = createWorktree({
      mainStateDir: join(gitRoot, stateDirRel),
      runId,
      branchPrefix,
      mergeStrategy,
      workDir: resolvedWorkDir,
    });
    effectiveWorkDir = wt.worktreePath;
    worktreeBranch = wt.branch;
    worktreePath = wt.worktreePath;
    worktreeMetaDir = wt.metaDir;
    effectiveStateDir = join(wt.worktreePath, stateDirRel);
  }

  // Compute active profiles: config defaults (unless suppressed) + CLI explicit
  const cliProfiles = runOptions.profiles ?? [];
  const noDefaults = runOptions.noDefaultProfiles ?? false;
  const configDefaults = noDefaults ? [] : config.getProfileDefaults(cfg);
  const activeProfiles = [...configDefaults, ...cliProfiles];

  // Tasks are always per-run: use effectiveStateDir (already per-run for
  // run-scoped/worktree), or route to runs/<runId>/ for shared mode.
  const tasksFile =
    isolation.mode === "run-scoped" || isolation.mode === "worktree"
      ? join(effectiveStateDir, "tasks.jsonl")
      : join(stateDir, "runs", runId, "tasks.jsonl");

  const runMemoryFile =
    isolation.mode === "run-scoped" || isolation.mode === "worktree"
      ? join(effectiveStateDir, "memory.jsonl")
      : join(stateDir, "runs", runId, "memory.jsonl");

  // Only paths, runtime, launch, profiles, and store survive — reloadLoop fills the rest from config.
  const seed = {
    paths: {
      projectDir: resolvedProjectDir,
      workDir: effectiveWorkDir,
      stateDir: effectiveStateDir,
      journalFile:
        isolation.mode === "worktree"
          ? join(effectiveStateDir, "journal.jsonl")
          : journalFile,
      memoryFile,
      runMemoryFile,
      tasksFile,
      registryFile,
      toolPath: join(effectiveStateDir, "autoloops"),
      piAdapterPath: join(effectiveStateDir, "pi-adapter"),
      baseStateDir: stateDir,
      mainProjectDir: resolvedProjectDir,
      worktreeBranch,
      worktreePath,
      worktreeMetaDir,
      configWorkDir,
    },
    runtime: {
      runId,
      selfCommand,
      promptOverride: promptOverride ?? null,
      backendOverride,
      configOverride,
      logLevel,
      branchMode: false,
      isolationMode: isolation.mode,
      noResume: runOptions.noResume ?? false,
    },
    launch: {
      preset: currentPresetName,
      trigger: runOptions.trigger ?? "cli",
      createdAt: new Date().toISOString(),
      parentRunId: runOptions.parentRunId ?? "",
      presetFile,
    },
    profiles: {
      active: activeProfiles,
      fragments: new Map<string, string>(),
      warnings: [] as string[],
    },
    store: {},
  } as unknown as LoopContext;
  return reloadLoop(seed);
}

export function reloadLoop(loop: LoopContext): LoopContext {
  const pd = loop.paths.projectDir;
  const wd = loop.paths.workDir;
  const presetFile = loop.launch.presetFile ?? "";
  const loadOptions = {
    presetName: loop.launch.preset,
    workDir: loop.paths.configWorkDir || wd,
    cliOverride: loop.runtime.configOverride,
  };
  const cfg = presetFile
    ? config.loadProjectFromFile(presetFile, loadOptions)
    : config.loadProject(pd, loadOptions);
  const topoData = presetFile
    ? topo.loadTopologyFromFile(presetFile)
    : topo.loadTopology(pd);
  validateRoleBackendKinds(topoData);

  const backend = readBackendConfig(cfg, loop.runtime.backendOverride);
  const review = readReviewConfig(cfg, topoData, pd, backend);
  const parallel = readParallelConfig(cfg);

  // Resolve and apply profile fragments
  const activeProfiles = loop.profiles?.active ?? [];
  let profileInfo = loop.profiles ?? {
    active: [],
    fragments: new Map(),
    warnings: [],
  };
  let finalTopology = topoData;
  if (activeProfiles.length > 0) {
    const presetName = loop.launch.preset;
    const resolved = profiles.resolveProfileFragments(
      activeProfiles,
      presetName,
      topoData.roles,
      wd,
    );
    profileInfo = {
      active: activeProfiles,
      fragments: resolved.fragments,
      warnings: resolved.warnings,
    };
    finalTopology = {
      ...topoData,
      roles: profiles.applyProfileFragments(topoData.roles, resolved.fragments),
    };
    for (const w of resolved.warnings) {
      process.stderr.write(`profile warning: ${w}\n`);
    }
  }

  const templateVars: Record<string, string> = {
    STATE_DIR: loop.paths.stateDir,
    TOOL_PATH: loop.paths.toolPath,
    // Absolute path to the preset/config dir (holds roles, scripts, hooks). Lets a
    // role reference preset-bundled scripts by path — e.g. a bootstrap script the
    // loop runs before any copied-in scripts exist in the work dir.
    PRESET_DIR: absolutePath(pd),
  };

  const updatedTopology: topo.Topology = {
    ...finalTopology,
    roles: finalTopology.roles.map((role) => {
      const prompt = expandTemplatePlaceholders(role.prompt, templateVars);
      assertNoRawAutoloopPaths(prompt, `role prompt: ${role.id}`);
      return { ...role, prompt };
    }),
  };

  // Per-iteration runtime cap: when set, it overrides backend.timeout_ms
  // (the branch-mode clamp and per-role backend_timeout_ms still apply later).
  const maxIterationRuntimeMs = config.getDuration(
    cfg,
    "event_loop.max_iteration_runtime",
    0,
  );

  const updated: LoopContext = {
    objective: resolvePrompt(pd, cfg, loop.runtime.promptOverride, {
      workDir: wd,
      stateDir: loop.paths.stateDir,
      baseStateDir: loop.paths.baseStateDir,
    }),
    topology: updatedTopology,
    limits: {
      maxIterations: config.getInt(cfg, "event_loop.max_iterations", 3),
      stallIterations: config.getInt(cfg, "event_loop.stall_iterations", 0),
      maxCostUsd: config.getFloat(cfg, "event_loop.max_cost_usd", 0),
      maxIterationRuntimeMs,
      maxRuntimeMs: config.getDuration(cfg, "event_loop.max_runtime", 0),
      transientMaxPauses: config.getInt(
        cfg,
        "event_loop.transient_max_pauses",
        3,
      ),
      transientPauseMs: config.getDuration(
        cfg,
        "event_loop.transient_pause",
        5000,
      ),
      transientBackoffCapMs: config.getDuration(
        cfg,
        "event_loop.transient_backoff_cap",
        30000,
      ),
      prematureMaxRearms: config.getInt(
        cfg,
        "event_loop.premature_max_rearms",
        1,
      ),
    },
    completion: {
      promise: config.get(
        cfg,
        "event_loop.completion_promise",
        "LOOP_COMPLETE",
      ),
      event: topo.completionEvent(
        topoData,
        config.get(cfg, "event_loop.completion_event", "task.complete"),
      ),
      requiredEvents: config.getList(cfg, "event_loop.required_events"),
      mustBeLast: truthySetting(
        config.get(cfg, "event_loop.completion_must_be_last", "false"),
      ),
    },
    policy: {
      fileModAudit: truthySetting(
        config.get(cfg, "event_loop.audit_file_mods", "false"),
      ),
    },
    acceptance: {
      // Accept either a single `verify_cmd` or a `verify_cmds` list; merge both.
      verifyCmds: [
        ...config.getList(cfg, "acceptance.verify_cmds"),
        ...(() => {
          const single = config.get(cfg, "acceptance.verify_cmd", "").trim();
          return single ? [single] : [];
        })(),
      ],
      timeoutMs: config.getDuration(cfg, "acceptance.timeout", 300000),
      assertNoTodo: truthySetting(
        config.get(cfg, "acceptance.assert_no_todo", "false"),
      ),
      assertNoSkippedTests: truthySetting(
        config.get(cfg, "acceptance.assert_no_skipped_tests", "false"),
      ),
      assertNoSecrets: truthySetting(
        config.get(cfg, "acceptance.assert_no_secrets", "false"),
      ),
      assertCleanTree: truthySetting(
        config.get(cfg, "acceptance.assert_clean_tree", "false"),
      ),
      screenTestTamper: truthySetting(
        config.get(cfg, "acceptance.screen_test_tamper", "false"),
      ),
      criteria: config.getList(cfg, "acceptance.criteria"),
    },
    ask: {
      event: config.get(cfg, "event_loop.ask_event", "human.ask"),
      enabled: config.get(cfg, "event_loop.ask_event", "human.ask") !== "",
      timeoutMs: config.getDuration(cfg, "event_loop.ask_timeout", 300000),
      pollMs: config.getInt(cfg, "event_loop.ask_poll_ms", 500),
    },
    backend:
      maxIterationRuntimeMs > 0
        ? { ...backend, timeoutMs: maxIterationRuntimeMs }
        : backend,
    review: {
      ...review,
      prompt: (() => {
        const p = expandTemplatePlaceholders(review.prompt, templateVars);
        assertNoRawAutoloopPaths(p, "metareview prompt");
        return p;
      })(),
    },
    parallel,
    stage: readStageConfig(cfg),
    hooks: {
      // Hook commands get the same template vars as role prompts ({{PRESET_DIR}},
      // {{TOOL_PATH}}, {{STATE_DIR}}) so a hook can reference preset-bundled scripts by
      // path — e.g. a deterministic bootstrap (okf-init) run before any agent turn.
      preRun: expandTemplatePlaceholders(
        config.get(cfg, "hooks.pre_run", ""),
        templateVars,
      ),
      preIteration: expandTemplatePlaceholders(
        config.get(cfg, "hooks.pre_iteration", ""),
        templateVars,
      ),
      postIteration: expandTemplatePlaceholders(
        config.get(cfg, "hooks.post_iteration", ""),
        templateVars,
      ),
      postRun: expandTemplatePlaceholders(
        config.get(cfg, "hooks.post_run", ""),
        templateVars,
      ),
      strict: config.get(cfg, "hooks.strict", "false") === "true",
      specs: expandHookSpecCommands(
        presetFile
          ? config.loadHookSpecsFromFile(presetFile)
          : config.loadHookSpecs(pd),
        templateVars,
      ),
    },
    memory: {
      budgetChars: config.getInt(cfg, "memory.prompt_budget_chars", 8000),
    },
    tasks: {
      budgetChars: config.getInt(cfg, "tasks.prompt_budget_chars", 4000),
    },
    progress: {
      metricCmd: config.get(cfg, "progress.metric_cmd", ""),
      name: config.get(cfg, "progress.name", "progress"),
      timeoutMs: config.getDuration(cfg, "progress.timeout", 60000),
    },
    harness: {
      instructions: (() => {
        const raw = readOptionalProjectFile(
          pd,
          config.get(cfg, "harness.instructions_file", "harness.md"),
        );
        const expanded = expandTemplatePlaceholders(raw, templateVars);
        assertNoRawAutoloopPaths(expanded, "harness instructions");
        return expanded;
      })(),
    },
    profiles: profileInfo,
    paths: loop.paths,
    runtime: loop.runtime,
    launch: loop.launch,
    store: loop.store,
    agentMap: loadAgentMap(pd),
    // Alias, never copy: all reloaded contexts must share one session holder.
    acpSession: loop.acpSession ?? { current: undefined },
    piSession: loop.piSession ?? { current: undefined },
    claudeSdkSession: loop.claudeSdkSession ?? { current: undefined },
    commandSession: loop.commandSession ?? { current: undefined },
    onEvent: loop.onEvent,
    signal: loop.signal,
  };
  return applyRuntimeModeOverrides(updated);
}

function validateRoleBackendKinds(topology: topo.Topology): void {
  for (const role of topology.roles) {
    if (role.backendKind === undefined) continue;
    resolveProcessKind(role.backendKind, role.backendCommand ?? "", {
      hasCustomArgs:
        role.backendArgs !== undefined && role.backendArgs.length > 0,
      roleId: role.id,
    });
  }
}

function readBackendConfig(
  cfg: config.Config,
  bo: Record<string, unknown>,
): LoopContext["backend"] {
  let rawKind = processStringOverride(
    bo,
    "kind",
    config.get(cfg, "backend.kind", ""),
  );
  const cfgCommandMarker = "__missing_command__";
  const cfgCommand = config.get(cfg, "backend.command", cfgCommandMarker);
  const explicitCommand =
    typeof bo.command === "string"
      ? bo.command
      : cfgCommand !== cfgCommandMarker
        ? cfgCommand
        : "";
  const rawProvider = processStringOverride(
    bo,
    "provider",
    config.get(cfg, "backend.provider", ""),
  );
  const acpProvider = resolveAcpProvider({
    kind: rawKind,
    provider: rawProvider,
    command: explicitCommand,
  });
  // If the config specifies an explicit provider (not a generic fallback), ensure
  // the ACP path so that resolveProcessKind derives the right backend kind.
  // This handles the case where `backend.provider = "hermes"` is set in config
  // without an explicit `backend.kind`.
  if (!rawKind && rawProvider && acpProvider.id !== "generic") {
    rawKind = "acp";
  }
  const commandFallback = isAcpBackendKind(rawKind)
    ? acpProvider.defaultCommand
    : "claude";
  const command = processStringOverride(
    bo,
    "command",
    cfgCommand !== cfgCommandMarker ? cfgCommand : commandFallback,
  );
  const cfgArgsMarker = "__missing_args__";
  const rawCfgArgs = config.get(cfg, "backend.args", cfgArgsMarker);
  const hasCustomArgs =
    (Array.isArray(bo.args) && bo.args.length > 0) ||
    (rawCfgArgs !== cfgArgsMarker && splitCsv(rawCfgArgs).length > 0);
  const kind = resolveProcessKind(rawKind, command, { hasCustomArgs });
  const provider = kind === "acp" ? acpProvider.id : "";
  const argsFallback =
    rawCfgArgs === cfgArgsMarker
      ? kind === "acp"
        ? acpProvider.defaultArgs
        : []
      : configListWithFallback(cfg, "backend.args", []);
  const rawArgs = processListOverride(bo, "args", argsFallback);
  const args =
    kind === "command" ? injectClaudePermissions(command, rawArgs) : rawArgs;
  const cfgPromptMarker = "__missing_prompt_mode__";
  const rawCfgPromptMode = config.get(
    cfg,
    "backend.prompt_mode",
    cfgPromptMarker,
  );
  const promptModeFallback =
    rawCfgPromptMode === cfgPromptMarker
      ? kind === "acp"
        ? acpProvider.defaultPromptMode
        : "arg"
      : rawCfgPromptMode;
  const promptMode = normalizePromptMode(
    processStringOverride(bo, "prompt_mode", promptModeFallback),
  );
  const timeoutMs = processIntOverride(
    bo,
    "timeout_ms",
    config.getInt(cfg, "backend.timeout_ms", 300000),
  );
  const trustAllTools = processBoolOverride(
    bo,
    "trust_all_tools",
    config.get(cfg, "backend.trust_all_tools", "true") !== "false",
  );
  const agent = processStringOverride(
    bo,
    "agent",
    config.get(cfg, "backend.agent", ""),
  );
  const model = processStringOverride(
    bo,
    "model",
    config.get(cfg, "backend.model", ""),
  );
  const profile = processStringOverride(
    bo,
    "profile",
    config.get(cfg, "backend.profile", ""),
  );
  // Tools the backend must NOT expose to the agent (claude-sdk only). Opt-in via
  // `backend.disallowed_tools` (CSV); empty by default so other presets are
  // unaffected. Used e.g. to force a preset onto a dedicated capture tool by
  // removing the built-in WebFetch/WebSearch.
  const disallowedTools = config.getList(cfg, "backend.disallowed_tools");
  // Opt-in cost-telemetry convention for `command`-kind backends. See
  // `usage_from` in config-schema.ts for the contract.
  const usageFrom = processStringOverride(
    bo,
    "usage_from",
    config.get(cfg, "backend.usage_from", ""),
  );
  return {
    kind,
    provider,
    command,
    args,
    promptMode,
    timeoutMs,
    trustAllTools,
    agent,
    model,
    profile,
    disallowedTools,
    usageFrom,
  };
}

function readReviewConfig(
  cfg: config.Config,
  topoData: topo.Topology,
  projectDir: string,
  backend: LoopContext["backend"],
): LoopContext["review"] {
  const command = config.get(cfg, "review.command", backend.command);
  const kind = resolveProcessKind(
    config.get(cfg, "review.kind", backend.kind),
    command,
  );
  const provider = config.get(cfg, "review.provider", backend.provider);
  return {
    enabled: truthySetting(config.get(cfg, "review.enabled", "true")),
    every: resolveReviewEvery(cfg, topoData),
    adversarialFirst: truthySetting(
      config.get(cfg, "review.adversarial_first", "true"),
    ),
    kind,
    provider: kind === "acp" ? provider || backend.provider || "generic" : "",
    command,
    args: configListWithFallback(cfg, "review.args", backend.args),
    promptMode: normalizePromptMode(
      config.get(cfg, "review.prompt_mode", backend.promptMode),
    ),
    prompt: resolveReviewPrompt(projectDir, cfg),
    timeoutMs: config.getInt(cfg, "review.timeout_ms", 300000),
    trustAllTools:
      config.get(
        cfg,
        "review.trust_all_tools",
        String(backend.trustAllTools),
      ) !== "false",
    agent: config.get(cfg, "review.agent", backend.agent),
    model: config.get(cfg, "review.model", backend.model),
    profile: config.get(cfg, "review.profile", backend.profile ?? ""),
    onError: normalizeReviewOnError(config.get(cfg, "review.on_error", "hold")),
    minConfidence: config.getFloat(cfg, "review.min_confidence", 0.5),
  };
}

/**
 * Coerce the `review.on_error` setting to a known mode, defaulting to the
 * fail-closed `hold` for unset or unrecognized values.
 */
function normalizeReviewOnError(raw: string): ReviewOnError {
  const v = raw.trim().toLowerCase();
  return v === "exit" || v === "continue" ? v : "hold";
}

function readParallelConfig(cfg: config.Config): LoopContext["parallel"] {
  return {
    enabled: truthySetting(config.get(cfg, "parallel.enabled", "false")),
    maxBranches: config.getInt(cfg, "parallel.max_branches", 3),
    branchTimeoutMs: config.getInt(cfg, "parallel.branch_timeout_ms", 180000),
    aggregate: {
      mode: normalizeAggregateMode(
        config.get(cfg, "parallel.aggregate.mode", "wait_for_all"),
      ),
      timeoutMs: config.getInt(cfg, "parallel.aggregate.timeout_ms", 0),
    },
  };
}

/** Fallback-safe aggregate-mode guard: unrecognized values default to `wait_for_all`. */
function normalizeAggregateMode(
  raw: string,
): "wait_for_all" | "first_success" | "timeout" {
  return raw === "first_success" || raw === "timeout" ? raw : "wait_for_all";
}

function readStageConfig(cfg: config.Config): LoopContext["stage"] {
  return {
    concurrency: config.getInt(
      cfg,
      "stage.concurrency",
      concurrency.defaultConcurrency(),
    ),
    branchTimeoutMs: config.getInt(cfg, "stage.branch_timeout_ms", 180000),
  };
}

export function applyRuntimeModeOverrides(loop: LoopContext): LoopContext {
  if (!loop.runtime.branchMode) return loop;
  return {
    ...loop,
    limits: { maxIterations: 1 },
    review: { ...loop.review, enabled: false },
    parallel: { ...loop.parallel, enabled: false },
    backend: {
      ...loop.backend,
      timeoutMs: Math.min(
        loop.backend.timeoutMs,
        loop.parallel.branchTimeoutMs,
      ),
    },
  };
}

/** Apply the same template-placeholder expansion legacy hook fields get to
 * every structured hook spec's command (e.g. `{{PRESET_DIR}}`, `{{TOOL_PATH}}`). */
function expandHookSpecCommands(
  specs: HookSpec[],
  templateVars: Record<string, string>,
): HookSpec[] {
  return specs.map((spec) => ({
    ...spec,
    command: expandTemplatePlaceholders(spec.command, templateVars),
  }));
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
