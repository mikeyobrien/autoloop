import { type KillTreeDeps, killProcessTree } from "@mobrienv/autoloop-core";

/**
 * End the in-flight `command` iteration child on teardown (abort, throw, run
 * end). POSIX: SIGTERM to the child pid only, not its process group. win32:
 * the child is the Git `sh.exe` launcher; ending only the launcher leaves the
 * shell and the agent running with the stdout pipe open, so the whole process
 * tree is killed.
 */
export function terminateCommandChild(
  pid: number,
  killDeps?: KillTreeDeps,
): void {
  if ((killDeps?.platform ?? process.platform) === "win32") {
    killProcessTree(pid, "SIGTERM", killDeps);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already exited */
  }
}
