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
}
