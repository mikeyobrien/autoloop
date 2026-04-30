import type { AcpSession } from "@mobrienv/autoloop-backends/acp-client";
import type { AgentMap } from "@mobrienv/autoloop-core/agent-map";
import type * as topo from "@mobrienv/autoloop-core/topology";
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
  limits: { maxIterations: number };
  completion: { promise: string; event: string; requiredEvents: string[] };
  backend: {
    kind: string;
    command: string;
    args: string[];
    promptMode: string;
    timeoutMs: number;
  };
  review: {
    enabled: boolean;
    every: number;
    adversarialFirst: boolean;
    kind: string;
    command: string;
    args: string[];
    promptMode: string;
    prompt: string;
    timeoutMs: number;
  };
  parallel: { enabled: boolean; maxBranches: number; branchTimeoutMs: number };
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
  };
  runtime: {
    runId: string;
    selfCommand: string;
    promptOverride: string | null;
    backendOverride: Record<string, unknown>;
    logLevel: string;
    branchMode: boolean;
    isolationMode: string;
  };
  launch: LaunchMetadata;
  store: Record<string, unknown>;
  agentMap: AgentMap | null;
  kiroSession?: AcpSession;
  lastVerdict?: Verdict;
  /** Optional structured-event emitter, forwarded from RunOptions.onEvent. */
  onEvent?: LoopEventEmitter;
}

export interface RunOptions {
  workDir?: string;
  backendOverride?: Record<string, unknown>;
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
