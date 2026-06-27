import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { ClaudeSdkSession } from "@mobrienv/autoloop-backends/claude-sdk-client";
import type { PiSession } from "@mobrienv/autoloop-backends/pi-rpc-client";
import type { AgentMap } from "@mobrienv/autoloop-core/agent-map";
import type * as topo from "@mobrienv/autoloop-core/topology";
import type { LiveControlAdapter } from "./control/adapter.js";
import type { LoopEventEmitter } from "./events.js";

export type TriggerSource = "cli" | "chain" | "branch";

export interface LaunchMetadata {
  preset: string;
  trigger: TriggerSource;
  createdAt: string;
  parentRunId: string;
}

export interface ProfileInfo {
  active: string[];
  fragments: Map<string, string>;
  warnings: string[];
}

export type VerdictKind = "CONTINUE" | "REDIRECT" | "TAKEOVER" | "EXIT";

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
  };
  completion: { promise: string; event: string; requiredEvents: string[] };
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
    profile?: string;
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
    profile?: string;
  };
  parallel: { enabled: boolean; maxBranches: number; branchTimeoutMs: number };
  hooks: {
    preRun: string;
    preIteration: string;
    postIteration: string;
    postRun: string;
    strict: boolean;
  };
  memory: { budgetChars: number };
  tasks: { budgetChars: number };
  harness: { instructions: string };
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
