// Spawn an autoloop run inside a tmux session bound to a kanban task.
//
// Shape: `autoloop run <preset> <prompt>` — autoloop is non-interactive, so
// the prompt is passed as positional argv; no send-keys keystroke injection.
// Tmux owns cwd via `new-session -c`; the attach PTY we hand back forwards
// bytes to the browser and survives dashboard restarts (kill the attach
// client, leave the session running).

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import type { KanbanHooksConfig } from "./config.js";
import type { IPtyLike } from "./pty_session.js";
import type { Task, TaskStore } from "./task_store.js";
import {
  shellEscape,
  TMUX_SOCKET,
  tmuxConfPath,
  tmuxHasSession,
  tmuxNewSessionWithCommand,
  tmuxSessionName,
} from "./tmux.js";

export interface SpawnAutoloopOptions {
  /** Autoloop binary to exec. Resolved by the caller (e.g. CLI wrapper). */
  autoloopBin: string;
  /** Preset to pass to `autoloop run` when the task has no explicit preset. */
  defaultPreset: string;
  /** Hook config. Defaults to `{before_run:"", after_run:"", timeout_ms:60_000}`. */
  hooks?: KanbanHooksConfig;
}

export interface SpawnAutoloopResult {
  pty: IPtyLike;
  pid: number;
  runId: string;
  cwd: string;
  tmuxSession: string;
}

const FORBIDDEN_ROOTS = [
  "/etc",
  "/bin",
  "/sbin",
  "/usr",
  "/System",
  "/Library/Extensions",
  "/boot",
];

export function validateWorkspaceCwd(
  cwd: string,
  workspaceRoot?: string,
): { ok: true; resolved: string } | { ok: false; error: string } {
  let resolved: string;
  try {
    resolved = resolve(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `resolve failed: ${msg}` };
  }
  if (resolved === "/")
    return { ok: false, error: "cwd resolves to filesystem root /" };
  if (!existsSync(resolved))
    return { ok: false, error: `cwd does not exist: ${resolved}` };
  try {
    if (!statSync(resolved).isDirectory()) {
      return { ok: false, error: `cwd is not a directory: ${resolved}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `stat failed: ${msg}` };
  }
  for (const root of FORBIDDEN_ROOTS) {
    if (resolved === root || resolved.startsWith(root + "/")) {
      return {
        ok: false,
        error: `cwd under forbidden system path ${root}: ${resolved}`,
      };
    }
  }
  if (workspaceRoot) {
    let rootAbs: string;
    try {
      rootAbs = resolve(workspaceRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `workspace root resolve failed: ${msg}` };
    }
    if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
      return {
        ok: false,
        error: `cwd escapes workspace root ${rootAbs}: ${resolved}`,
      };
    }
  }
  return { ok: true, resolved };
}

export function runHook(
  kind: "before_run" | "after_run",
  script: string,
  cwd: string,
  timeoutMs: number,
  taskId: string,
): boolean {
  const trimmed = script.trim();
  if (!trimmed) return true;
  try {
    execSync(trimmed, {
      cwd,
      shell: "/bin/sh",
      timeout: Math.max(1_000, timeoutMs),
      stdio: "pipe",
      env: {
        ...process.env,
        AUTOLOOP_KANBAN_TASK_ID: taskId,
        AUTOLOOP_KANBAN_HOOK: kind,
      },
    });
    process.stderr.write(`[autoloop-kanban] hook ${kind} ok task=${taskId}\n`);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stderr?: Buffer;
      stdout?: Buffer;
    };
    const tail = (
      e.stderr?.toString() ||
      e.stdout?.toString() ||
      e.message ||
      ""
    ).slice(-500);
    process.stderr.write(
      `[autoloop-kanban] hook ${kind} FAILED task=${taskId} — ${tail}\n`,
    );
    return false;
  }
}

/** Build the exact shell command string fed to `tmuxNewSessionWithCommand`.
 * Extracted for unit testing — the spawn path has too many side effects
 * (tmux, PTY, native addon load) to assert command shape inline. */
export function buildAutoloopCommand(
  task: Task,
  runId: string,
  opts: { autoloopBin: string; defaultPreset: string },
): string {
  const preset = task.preset ?? opts.defaultPreset;
  const prompt =
    task.title + (task.description ? `\n\n${task.description}` : "");
  return (
    `AUTOLOOP_KANBAN_TASK_ID=${shellEscape(task.id)} ` +
    `AUTOLOOP_KANBAN_RUN_ID=${shellEscape(runId)} ` +
    `${shellEscape(opts.autoloopBin)} run ${shellEscape(preset)} ${shellEscape(prompt)}`
  );
}

export function spawnAutoloopForTask(
  task: Task,
  cols: number,
  rows: number,
  store: TaskStore,
  opts: SpawnAutoloopOptions,
): SpawnAutoloopResult {
  const rawCwd =
    task.worktree?.path ??
    task.autoloop?.workspace ??
    task.scope ??
    process.cwd();
  const guard = validateWorkspaceCwd(rawCwd);
  if (!guard.ok) throw new Error(`workspace guard: ${guard.error}`);
  const cwd = guard.resolved;

  const hooks = opts.hooks ?? {
    before_run: "",
    after_run: "",
    timeout_ms: 60_000,
  };
  if (
    !runHook("before_run", hooks.before_run, cwd, hooks.timeout_ms, task.id)
  ) {
    throw new Error("before_run hook failed");
  }

  const runId = task.autoloop?.run_id ?? `kanban-${task.id}`;
  const tmuxName = tmuxSessionName(task);
  const existed = tmuxHasSession(tmuxName);

  if (!existed) {
    const cmd = buildAutoloopCommand(task, runId, {
      autoloopBin: opts.autoloopBin,
      defaultPreset: opts.defaultPreset,
    });
    tmuxNewSessionWithCommand(tmuxName, cwd, cols, rows, cmd);
  }

  const req = createRequire(import.meta.url);
  const nodePty = req(
    "@homebridge/node-pty-prebuilt-multiarch",
  ) as typeof import("@homebridge/node-pty-prebuilt-multiarch");
  const env = {
    ...(process.env as Record<string, string>),
    EDITOR: "nano",
    VISUAL: "nano",
    GIT_EDITOR: "nano",
    TERM: "xterm-256color",
  };
  const pty = nodePty.spawn(
    "tmux",
    [
      "-L",
      TMUX_SOCKET,
      "-f",
      tmuxConfPath(),
      "attach-session",
      "-d",
      "-t",
      tmuxName,
    ],
    { name: "xterm-256color", cols, rows, cwd, env },
  );

  if (!existed) {
    const r = store.setAutoloop(task.id, {
      run_id: runId,
      workspace: cwd,
      state: "running",
    });
    if (r.error) {
      process.stderr.write(
        `[autoloop-kanban] setAutoloop failed task=${task.id}: ${r.error}\n`,
      );
    }
  }

  return {
    pty: pty as unknown as IPtyLike,
    pid: pty.pid ?? 0,
    runId,
    cwd,
    tmuxSession: tmuxName,
  };
}
