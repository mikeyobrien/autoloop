import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { ClaudeSdkSession } from "@mobrienv/autoloop-backends/claude-sdk-client";
import type { PiSession } from "@mobrienv/autoloop-backends/pi-rpc-client";
import type { AgentMap } from "@mobrienv/autoloop-core/agent-map";
import type { HookSpec } from "@mobrienv/autoloop-core/hooks-schema";
import type * as topo from "@mobrienv/autoloop-core/topology";
import type { LiveControlAdapter } from "./control/adapter.js";
import type { LoopEventEmitter } from "./events.js";

export type TriggerSource = "cli" | "chain" | "branch";

export interface LaunchMetadata {
  preset: string;
  trigger: TriggerSource;
  createdAt: string;
  parentRunId: string;
  /**
   * Absolute path to a single-file (`.toml`) preset, when the run was launched
   * from one. Config and topology are loaded from this file instead of the
   * `projectDir`'s `autoloops.toml` + `topology.toml`. Empty for directory
   * presets.
   */
  presetFile?: string;
}

export interface ProfileInfo {
  active: string[];
  fragments: Map<string, string>;
  warnings: string[];
}

export type VerdictKind =
  | "CONTINUE"
  | "REDIRECT"
  | "TAKEOVER"
  | "EXIT"
  // Fail-closed sentinel: the reviewer produced no usable signal (malformed /
  // empty output, timeout, or below-threshold confidence). Never advances the
  // loop on its own — routed by `[review].on_error` to hold or exit.
  | "UNKNOWN";

/** What to do when a metareview yields an UNKNOWN verdict. */
export type ReviewOnError = "hold" | "exit" | "continue";

export interface Verdict {
  verdict: VerdictKind;
  confidence: number;
  reasoning: string;
  redirect_prompt?: string;
  takeover_output?: string;
  suggestions?: string[];
}

export interface LoopContext {
  objective: string;
  topology: topo.Topology;
  limits: {
    maxIterations: number;
    /** Stop after N consecutive identical backend outputs (0 = disabled). */
    stallIterations?: number;
    /** Stop once journaled run cost reaches this USD budget (0 = disabled). */
    maxCostUsd?: number;
    /** Per-iteration runtime cap in ms (0 = fall back to backend.timeoutMs). */
    maxIterationRuntimeMs?: number;
    /** Loop wall-clock budget in ms (0 = disabled). */
    maxRuntimeMs?: number;
    /**
     * Circuit-breaker: max transient/rate-limit pauses before the breaker opens
     * and the run stops with a typed reason. Default 3.
     */
    transientMaxPauses?: number;
    /** Base backoff (ms) for the transient retry ladder. Default 5000. */
    transientPauseMs?: number;
    /** Upper bound (ms) on the exponential transient backoff. Default 30000. */
    transientBackoffCapMs?: number;
    /**
     * Max times a premature quit (stall with authorized work remaining and no
     * blocker) is re-armed before it escalates to attention. Default 1.
     */
    prematureMaxRearms?: number;
  };
  completion: { promise: string; event: string; requiredEvents: string[] };
  /**
   * Out-of-band acceptance gate. On a done-claim the HARNESS (not the agent's
   * session) runs every `verifyCmds` entry in a clean shell; completion is
   * accepted only when all exit 0. A failing command blocks completion and
   * re-injects its output. Empty `verifyCmds` disables the gate.
   */
  acceptance: {
    verifyCmds: string[];
    timeoutMs: number;
    /**
     * Declarative required-absence guards evaluated at the acceptance gate
     * regardless of agent claims. Each defaults off (opt-in per preset) so
     * existing loops are unaffected. They catch reward-hacks the LLM gates miss:
     * leftover TODO/FIXME, skipped/only/xfail tests, committed secrets, and a
     * dirty/untracked working tree.
     */
    assertNoTodo: boolean;
    assertNoSkippedTests: boolean;
    assertNoSecrets: boolean;
    assertCleanTree: boolean;
    /**
     * Anti-reward-hack screen: under bypassPermissions the maker can edit the
     * very tests that gate it. When on, a test-backed done-claim is blocked if
     * the run modified test files or inserted tamper patterns (skip/only/xfail,
     * early exit, tautological assertions) on test paths. Default off.
     */
    screenTestTamper: boolean;
    /**
     * Intent-binding acceptance criteria captured at loop start (the contract
     * between what was asked and what is accepted). Sourced from
     * `[acceptance].criteria` and an "Acceptance criteria" section of the
     * objective. A criterion may bind a deterministic check with ` :: <shell
     * cmd>`; checked criteria gate completion, unchecked ones are advisory.
     */
    criteria: string[];
  };
  /**
   * Human-in-the-loop. When an agent emits `ask.event`, the loop blocks until
   * an operator responds (via the `respond` control verb) or `timeoutMs`
   * elapses, then injects the answer into the next prompt as guidance.
   * Disabled when `enabled` is false (ask.event is empty).
   */
  ask: { enabled: boolean; event: string; timeoutMs: number; pollMs: number };
  backend: {
    kind: string;
    provider: string;
    command: string;
    args: string[];
    promptMode: string;
    timeoutMs: number;
    trustAllTools: boolean;
    agent: string;
    model: string;
    disallowedTools: string[];
  };
  review: {
    enabled: boolean;
    every: number;
    adversarialFirst: boolean;
    kind: string;
    provider: string;
    command: string;
    args: string[];
    promptMode: string;
    prompt: string;
    timeoutMs: number;
    trustAllTools: boolean;
    agent: string;
    model: string;
    /**
     * Fail-closed routing for an UNKNOWN verdict (malformed/empty/timed-out
     * review, or confidence below `minConfidence`). Default `hold`: stop the
     * loop and raise attention rather than silently continuing.
     */
    onError: ReviewOnError;
    /**
     * A parsed verdict whose confidence is below this threshold is downgraded
     * to UNKNOWN. Default 0.5. Set 0 to disable confidence gating.
     */
    minConfidence: number;
  };
  parallel: { enabled: boolean; maxBranches: number; branchTimeoutMs: number };
  hooks: {
    preRun: string;
    preIteration: string;
    postIteration: string;
    postRun: string;
    strict: boolean;
    /**
     * Structured per-hook specs (legacy flat keys + `[[hook]]` entries),
     * merged and template-expanded. This is the engine's source of truth;
     * the flat fields above remain for backward compatibility with existing
     * callers/tests but `specs` is what `runPhaseHooks` iterates.
     */
    specs: HookSpec[];
  };
  memory: { budgetChars: number };
  tasks: { budgetChars: number };
  harness: { instructions: string };
  /**
   * Preset-declared progress metric: a command whose numeric stdout is the
   * scalar (tests passing, coverage, tasks closed, ...) journaled per iteration
   * to enable drift/convergence detection. Disabled when `metricCmd` is "".
   */
  progress?: { metricCmd: string; name: string; timeoutMs: number };
  profiles: ProfileInfo;
  paths: {
    projectDir: string;
    workDir: string;
    stateDir: string;
    journalFile: string;
    memoryFile: string;
    runMemoryFile: string;
    tasksFile: string;
    registryFile: string;
    toolPath: string;
    piAdapterPath: string;
    baseStateDir: string;
    mainProjectDir: string;
    worktreeBranch: string;
    worktreePath: string;
    worktreeMetaDir: string;
    configWorkDir: string;
  };
  runtime: {
    runId: string;
    selfCommand: string;
    promptOverride: string | null;
    backendOverride: Record<string, unknown>;
    configOverride: Record<string, unknown>;
    logLevel: string;
    branchMode: boolean;
    isolationMode: string;
  };
  launch: LaunchMetadata;
  store: Record<string, unknown>;
  agentMap: AgentMap | null;
  /**
   * Live ACP session holder. Aliased (not copied) across context reloads so
   * loop-exit, abort, and interrupt handlers always see the current session
   * even though iterations run on reloaded context clones.
   */
  acpSession: { current: AcpSession | undefined };
  /**
   * Live pi RPC session holder. Same aliasing rules as acpSession: the
   * process persists across iterations (context resets via `new_session`),
   * so reloads must share one holder.
   */
  piSession: { current: PiSession | undefined };
  /**
   * Live Claude Agent SDK session holder. Fresh session per iteration (one
   * query is one conversation), but aliased like the others so live control
   * (interrupt/steer) always targets the in-flight session.
   */
  claudeSdkSession: { current: ClaudeSdkSession | undefined };
  lastVerdict?: Verdict;
  /** Optional structured-event emitter, forwarded from RunOptions.onEvent. */
  onEvent?: LoopEventEmitter;
  controlAdapter?: LiveControlAdapter;
  /** Abort signal for the run; consulted while blocking on a human ask. */
  signal?: AbortSignal;
}

export interface RunOptions {
  workDir?: string;
  /**
   * Absolute path to a single-file (`.toml`) preset. When set, config and
   * topology are loaded from this file rather than from `projectDir`'s
   * `autoloops.toml` + `topology.toml`.
   */
  presetFile?: string;
  backendOverride?: Record<string, unknown>;
  configOverride?: Record<string, unknown>;
  logLevel?: string | null;
  prompt?: string | null;
  chain?: string | null;
  trigger?: TriggerSource;
  parentRunId?: string;
  profiles?: string[];
  noDefaultProfiles?: boolean;
  worktree?: boolean;
  noWorktree?: boolean;
  isolationMode?: string;
  mergeStrategy?: string;
  automerge?: boolean;
  keepWorktree?: boolean;
  /**
   * Optional abort signal. When provided, the CLI (or SDK caller) owns
   * process signal handling; the harness only listens to this signal for
   * graceful teardown. Without a signal the harness runs to completion
   * and no signal-handling is installed.
   */
  signal?: AbortSignal;
  /**
   * Optional structured-event listener. Emitted alongside the existing
   * terminal output; SDK consumers can drive custom UIs from this stream.
   */
  onEvent?: LoopEventEmitter;
}

export interface RunSummary {
  iterations: number;
  stopReason: string;
  runId?: string;
}
