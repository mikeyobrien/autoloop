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
import { resolvePosixShell } from "@mobrienv/autoloop-core";
import type { KanbanHooksConfig } from "./config.js";
import type { IPtyLike } from "./pty_session.js";
import type { Task, TaskStore } from "./task_store.js";
import {
  shellEscape,
  TMUX_SOCKET,
  tmuxAvailable,
  tmuxConfPath,
  tmuxHasSession,
  tmuxNewSessionWithCommand,
  tmuxSessionName,
} from "./tmux.js";

/** Optional dependency that gives kanban its browser terminals. */
export const NODE_PTY_PACKAGE = "@homebridge/node-pty-prebuilt-multiarch";

/** The part of the node-pty module that kanban uses. */
export interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): IPtyLike & { pid: number };
}

/**
 * Load node-pty. It is an optional dependency (no prebuild exists for some
 * Node versions and platforms), so a missing module becomes a clear error
 * for the kanban terminal instead of an install or startup failure.
 */
export function loadNodePty(
  requireFn: (id: string) => unknown = createRequire(import.meta.url),
): NodePtyModule {
  try {
    return requireFn(NODE_PTY_PACKAGE) as NodePtyModule;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `kanban terminals need the optional dependency ${NODE_PTY_PACKAGE}, ` +
        `which could not be loaded (${detail}). It has no prebuilt binary for ` +
        `some Node versions and platforms; reinstall autoloop with a Node LTS ` +
        `release to enable kanban terminals. The rest of autoloop works without it.`,
    );
  }
}

/** Message for a kanban terminal request when `tmux` cannot run. */
export function tmuxMissingMessage(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return (
      "kanban terminals need tmux, which is not available on native Windows. " +
      "Kanban terminal features are not supported on Windows; " +
      "run `autoloop kanban` under WSL to use them."
    );
  }
  return "kanban terminals need tmux, but `tmux -V` failed. Install tmux and make sure it is on PATH.";
}

/**
 * Create the tmux session for a task. When creation fails because tmux
 * itself is missing, throw `tmuxMissingMessage` instead of the raw
 * shell error.
 */
export function startTmuxSession(
  name: string,
  cwd: string,
  cols: number,
  rows: number,
  command: string,
  deps: {
    newSession: typeof tmuxNewSessionWithCommand;
    available: () => boolean;
    platform: NodeJS.Platform;
  } = {
    newSession: tmuxNewSessionWithCommand,
    available: tmuxAvailable,
    platform: process.platform,
  },
): void {
  try {
    deps.newSession(name, cwd, cols, rows, command);
  } catch (err) {
    if (!deps.available()) throw new Error(tmuxMissingMessage(deps.platform));
    throw err;
  }
}

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
      shell: resolvePosixShell(),
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
  // Load node-pty before any side effect (hook, tmux session): it is an
  // optional dependency, and a late failure would leave an untracked run.
  const nodePty = loadNodePty();

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
    startTmuxSession(tmuxName, cwd, cols, rows, cmd);
  }

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
    pty,
    pid: pty.pid ?? 0,
    runId,
    cwd,
    tmuxSession: tmuxName,
  };
}
