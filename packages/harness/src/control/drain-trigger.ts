import { canSignalUsr1 } from "@mobrienv/autoloop-core";

/** Poll interval for the control queue where SIGUSR1 cannot be delivered. */
export const CONTROL_POLL_INTERVAL_MS = 1000;

/**
 * Run `drain` whenever the CLI pokes the run. On POSIX `autoloop control`
 * sends SIGUSR1; on win32 no process can deliver SIGUSR1, so an unref'd timer
 * drains the durable control queue instead. Returns a function that stops the
 * timer (no-op on POSIX, where the SIGUSR1 listener stays installed).
 */
export function installControlDrainTrigger(
  drain: () => void,
  platform: NodeJS.Platform = process.platform,
): () => void {
  if (canSignalUsr1(platform)) {
    process.on("SIGUSR1", drain);
    return () => {};
  }
  const timer = setInterval(drain, CONTROL_POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
