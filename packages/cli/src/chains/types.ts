/**
 * Per-step backend override. Shape mirrors the subset of keys consumed by
 * readBackendConfig() in src/harness/config-helpers.ts: command, kind, args,
 * prompt_mode, timeout_ms. All keys are honored when provided.
 *
 * Precedence at merge time: step.backendOverride > runOptions.backendOverride
 * (CLI -b flag) > preset autoloops.toml defaults.
 */
export type StepBackendOverride = Record<string, unknown>;

export interface ChainStep {
  name: string;
  presetDir: string;
  backendOverride?: StepBackendOverride;
}

export interface ChainSpec {
  name: string;
  steps: ChainStep[];
}

export interface Budget {
  maxDepth: number;
  maxSteps: number;
  maxRuntimeMs: number;
  maxChildren: number;
  maxConsecutiveFailures: number;
}

export interface ChainsConfig {
  chains: ChainSpec[];
  budget: Budget;
}

export interface DynamicChainSpec {
  steps: string[];
  justification?: string;
  budget?: Budget;
  chainId?: string;
  parentId?: string;
}

export interface StepRecord {
  step: number;
  name: string;
  stopReason: string;
  runId?: string;
}

export interface ChainTracker {
  depth: number;
  totalSteps: number;
  children: number;
  consecutiveFailures: number;
}
