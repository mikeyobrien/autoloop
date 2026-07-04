export interface BackendSpec {
  kind: string;
  provider?: string;
  command: string;
  args: string[];
  promptMode: string;
  timeoutMs: number;
  trustAllTools?: boolean;
  agent?: string;
  model?: string;
  /** Provider-side agent profile (Hermes: launches as `--profile <p> acp`). */
  profile?: string;
  /**
   * Opt-in cost-telemetry convention for `command`-kind backends: `"file"`
   * means the wrapped command may report usage by writing a JSON object to
   * `$AUTOLOOP_USAGE_FILE` before exiting. Empty disables extraction (default;
   * no breaking change for existing presets).
   */
  usageFrom?: string;
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
  /**
   * When set, exported as `AUTOLOOP_USAGE_FILE` for the child process — the
   * side-file convention a `command` backend can opt into to report cost
   * telemetry. Always exported (cheap) regardless of `usage_from`; only read
   * back by the harness when `backend.usage_from = "file"` is configured.
   */
  usageFilePath?: string;
}
