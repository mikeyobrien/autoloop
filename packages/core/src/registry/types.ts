export type RegistryStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "stopped";

export interface RunRecord {
  run_id: string;
  status: RegistryStatus;
  preset: string;
  /**
   * Absolute path to a single-file (`.toml`) preset, when the run was launched
   * from one. Lets `resume` reload config + topology from the file rather than
   * the project directory. Omitted/empty for directory presets.
   */
  preset_file?: string;
  objective: string;
  trigger: string;
  project_dir: string;
  work_dir: string;
  state_dir: string;
  journal_file: string;
  parent_run_id: string;
  backend: string;
  backend_args: string[];
  created_at: string;
  updated_at: string;
  iteration: number;
  max_iterations: number;
  stop_reason: string;
  latest_event: string;
  isolation_mode: string;
  worktree_name: string;
  worktree_path: string;
  pid?: number;
  worktree_merged?: boolean;
  worktree_merged_at?: string | null;
  worktree_merge_strategy?: string;
  // --- Verified-outcome ledger (q6p.2) ---------------------------------------
  // Persisted per-run outcome facts so ROI / A-B / regression analytics read a
  // real, gate-verified numerator instead of re-deriving from `status`. All
  // optional for back-compat with records written before this field existed.
  /**
   * Verified outcome of the run, distinct from `status`. `verified` means the
   * run cleared the deterministic completion gate chain (acceptance gate +
   * postconditions + tamper screen + provisional release). `held`/`failed`/
   * `stopped`/`running` mirror the terminal disposition.
   */
  outcome?: RunOutcome;
  /** Last metareview verdict observed for the run (CONTINUE/EXIT/UNKNOWN/...). */
  verdict?: string;
  /** Journaled cost in USD at terminal time (sum of backend.usage events). */
  cost_usd?: number;
  /** True iff the run completed through the verified gate chain. */
  acceptance_verified?: boolean;
}

export type RunOutcome = "verified" | "held" | "failed" | "stopped" | "running";
