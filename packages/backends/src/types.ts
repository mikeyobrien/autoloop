export interface BackendSpec {
  kind: string;
  command: string;
  args: string[];
  promptMode: string;
  timeoutMs: number;
}

export interface BackendRunResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  providerKind: string;
  errorCategory: "none" | "timeout" | "non_zero_exit";
}

/**
 * Minimal path surface the backend invocation builder needs. Decoupled from
 * harness' full `LoopContext` so that consumers can embed the backend layer
 * without pulling in the harness runtime types.
 */
export interface BackendPaths {
  /** Per-run state directory — autoloop writes the active prompt under here. */
  stateDir: string;
  /** Absolute path to the pi adapter shim (only read when kind === "pi"). */
  piAdapterPath: string;
}

export interface BackendCommandContext {
  paths: BackendPaths;
  spec: Pick<BackendSpec, "kind" | "command" | "args" | "promptMode">;
  prompt: string;
  runtimeEnv: string;
}
