import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "./task_store.js";

export const TMUX_SOCKET = "autoloop-kanban";

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function tmuxConfPath(): string {
  try {
    const url = new URL("./kanban-tmux.conf", import.meta.url);
    const p = fileURLToPath(url);
    if (existsSync(p)) return p;
  } catch {
    /* fallthrough to dev path */
  }
  const devPath = join(process.cwd(), "packages/kanban/src/kanban-tmux.conf");
  return devPath;
}

export function tmuxCmd(...args: string[]): string {
  return `tmux -L ${shellEscape(TMUX_SOCKET)} -f ${shellEscape(tmuxConfPath())} ${args.join(" ")}`;
}

export function tmuxAvailable(): boolean {
  try {
    execSync("tmux -V", { stdio: "pipe", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

export function tmuxSessionName(task: Task): string {
  return `kanban-${task.id}`;
}

export function tmuxHasSession(name: string): boolean {
  try {
    execSync(tmuxCmd("has-session", "-t", shellEscape(name)), {
      stdio: "pipe",
      timeout: 2_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function tmuxNewSessionWithCommand(
  name: string,
  cwd: string,
  cols: number,
  rows: number,
  command: string,
): void {
  const userShell = process.env.SHELL || "/bin/bash";
  const posixCmd = `${command}; ec=$?; echo; echo "[autoloop exited (code $ec) — drop to shell]"; exec ${shellEscape(userShell)}`;
  const tmuxShellCmd = `exec /bin/sh -c ${shellEscape(posixCmd)}`;
  execSync(
    tmuxCmd(
      "new-session",
      "-d",
      "-s",
      shellEscape(name),
      "-x",
      String(cols),
      "-y",
      String(rows),
      "-c",
      shellEscape(cwd),
      shellEscape(tmuxShellCmd),
    ),
    { stdio: "pipe", timeout: 5_000 },
  );
}

export function tmuxKillSession(name: string): void {
  try {
    execSync(tmuxCmd("kill-session", "-t", shellEscape(name)), {
      stdio: "pipe",
      timeout: 3_000,
    });
  } catch {
    /* session may already be gone */
  }
}
