import { execFileSync } from "node:child_process";

/**
 * Run `git` with an argument vector (no shell string), so paths with spaces
 * and backslashes reach git unchanged on every platform, including cmd.exe.
 */
export function runGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env,
    stdio: "pipe",
    // A run started detached (dashboard, win32) has no console; without this
    // each git call would open a visible console window. Ignored on POSIX.
    windowsHide: true,
  });
}
