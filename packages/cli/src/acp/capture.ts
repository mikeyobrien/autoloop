// Output capture for "quick" CLI dispatchers invoked from the ACP console.
//
// The ACP agent communicates over stdout using NDJSON protocol frames, so the
// existing CLI dispatchers (which write human text via console.log /
// process.stdout.write) must NOT be allowed to write to the real stdout while
// an ACP connection is live. This helper temporarily redirects console.log,
// console.error, and the stdout/stderr write streams into an in-memory buffer
// for the duration of a synchronous-or-async dispatcher call, then restores
// them and returns the captured text.

export interface CaptureResult {
  /** Combined captured stdout text. */
  stdout: string;
  /** Combined captured stderr text. */
  stderr: string;
  /** The process.exitCode observed after the call (and reset to its prior value). */
  exitCode: number;
}

type WriteFn = typeof process.stdout.write;

/**
 * Run `fn` with stdout/stderr/console output captured into buffers. Always
 * restores the originals, even when `fn` throws. The captured exit code is the
 * value of process.exitCode set during the call; the prior exitCode is
 * restored so quick commands cannot poison the long-lived ACP process.
 */
export async function captureOutput(
  fn: () => void | Promise<void>,
): Promise<CaptureResult> {
  const out: string[] = [];
  const err: string[] = [];

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;
  const priorExitCode = process.exitCode;
  process.exitCode = 0;

  const makeWrite =
    (sink: string[]): WriteFn =>
    (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
      if (typeof chunk === "string") {
        sink.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        sink.push(Buffer.from(chunk).toString("utf8"));
      } else {
        sink.push(String(chunk));
      }
      // Honor the optional callback so callers awaiting a flush don't hang.
      const callback = typeof encoding === "function" ? encoding : cb;
      if (typeof callback === "function") {
        (callback as (e?: Error | null) => void)(null);
      }
      return true;
    };

  process.stdout.write = makeWrite(out) as WriteFn;
  process.stderr.write = makeWrite(err) as WriteFn;
  console.log = (...args: unknown[]) => out.push(`${formatArgs(args)}\n`);
  console.info = (...args: unknown[]) => out.push(`${formatArgs(args)}\n`);
  console.warn = (...args: unknown[]) => err.push(`${formatArgs(args)}\n`);
  console.error = (...args: unknown[]) => err.push(`${formatArgs(args)}\n`);

  try {
    await fn();
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    console.info = origInfo;
  }

  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = priorExitCode;

  return { stdout: out.join(""), stderr: err.join(""), exitCode };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : safeStringify(a)))
    .join(" ");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
