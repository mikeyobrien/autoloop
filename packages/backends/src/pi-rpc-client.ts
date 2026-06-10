import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export interface PiClientOptions {
  command: string;
  args: string[];
  cwd: string;
  modelId?: string;
  verbose?: boolean;
  /** Deadline for the init/reset RPC round trips (default 30s). */
  handshakeTimeoutMs?: number;
  /** How long a timed-out turn may drain after `abort` before the session is reused (default 2s). */
  abortGraceMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_ABORT_GRACE_MS = 2_000;
const STATS_TIMEOUT_MS = 3_000;
/** Cap on retained pi stderr — the process is long-lived, keep only the tail. */
const STDERR_CAP_BYTES = 64 * 1024;

interface PendingResponse {
  resolve: (msg: PiRpcMessage) => void;
  reject: (err: Error) => void;
}

export interface PiRpcMessage {
  type?: string;
  id?: string;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface PiSession {
  process: ChildProcess;
  options: PiClientOptions;
  textBuffer: string;
  stderrBuffer: string;
  lastError: string;
  /** Resolves when the child process exits — used to race against hanging prompts */
  closed: Promise<{ code: number | null; signal: string | null }>;
  nextRequestId: number;
  pending: Map<string, PendingResponse>;
  agentEndWaiters: ((event: PiRpcMessage) => void)[];
  /** Raw RPC lines for the in-flight prompt, flushed to streamLogPath. */
  streamLines: string[];
  /** Where to persist the raw RPC stream for the current prompt, if anywhere. */
  streamLogPath?: string;
}

export interface PiPromptResult {
  output: string;
  timedOut: boolean;
  error?: string;
}

/** Per-session usage totals from pi's `get_session_stats` RPC command. */
export interface PiUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  contextPercent?: number;
}

/**
 * Format a pi RPC event for verbose stderr output.
 * Returns null for event types that should be silenced.
 */
export function formatPiStreamingEvent(event: PiRpcMessage): string | null {
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent as
      | { type?: string; delta?: string }
      | undefined;
    if (delta?.type === "text_delta") return delta.delta ?? null;
    return null;
  }
  if (event.type === "tool_execution_start") {
    const name = typeof event.toolName === "string" ? event.toolName : "tool";
    return `[tool:${name}]\n`;
  }
  if (event.type === "tool_execution_end") {
    const name = typeof event.toolName === "string" ? event.toolName : "tool";
    return event.isError ? `[tool:✗] ${name}\n` : `[tool:✓] ${name}\n`;
  }
  return null;
}

/**
 * Spawn `pi --mode rpc` and verify the RPC channel with a get_state round
 * trip. The session holds one live pi process; iterations get fresh context
 * via resetPiSession (a `new_session` command) instead of respawning.
 */
export async function initPiSession(opts: PiClientOptions): Promise<PiSession> {
  const args = buildPiArgs(opts);
  const child = spawn(opts.command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: opts.cwd,
    env: process.env,
    detached: true, // own process group so terminatePiSession can kill the full tree
  });

  if (!child.stdout || !child.stdin) {
    throw new Error("Failed to create pi process stdio streams");
  }

  const session: PiSession = {
    process: child,
    options: opts,
    textBuffer: "",
    stderrBuffer: "",
    lastError: "",
    closed: new Promise((resolve) => {
      child.on("error", () => resolve({ code: null, signal: null }));
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    nextRequestId: 0,
    pending: new Map(),
    agentEndWaiters: [],
    streamLines: [],
  };

  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      session.stderrBuffer = (session.stderrBuffer + chunk.toString()).slice(
        -STDERR_CAP_BYTES,
      );
    });
  }

  attachJsonlReader(child, (line) => handlePiLine(session, line));

  // Reject all pending requests when the process dies so callers never hang.
  void session.closed.then(({ code, signal }) => {
    const err = crashError(session, code, signal);
    for (const pending of session.pending.values()) pending.reject(err);
    session.pending.clear();
  });

  // Handshake: confirm the RPC channel is live before reporting success. A
  // wedged spawn must not hang the loop — enforce a deadline and reap the
  // orphan on failure.
  try {
    await Promise.race([
      sendPiCommand(session, { type: "get_state" }),
      rejectAfter(handshakeTimeout(opts), "pi RPC handshake timed out"),
      session.closed.then(({ code, signal }) => {
        throw crashError(session, code, signal);
      }),
    ]);
  } catch (err) {
    await terminatePiSession(session).catch(() => {
      /* best-effort */
    });
    throw err;
  }
  return session;
}

/**
 * Send one autoloop iteration prompt and wait for the agent to finish.
 * Output is the accumulated assistant text (streaming deltas, with the
 * agent_end message list as fallback). On timeout the in-flight turn is
 * aborted via the RPC `abort` command and partial output is returned.
 */
export async function sendPiPrompt(
  session: PiSession,
  prompt: string,
  timeoutMs: number,
): Promise<PiPromptResult> {
  session.textBuffer = "";
  session.lastError = "";
  session.streamLines = [];

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const agentEnd = waitForAgentEnd(session);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("pi prompt timed out"));
    }, timeoutMs);
  });
  const crashPromise = session.closed.then(({ code, signal }) => {
    throw crashError(session, code, signal);
  });

  try {
    const ack = await Promise.race([
      sendPiCommand(session, { type: "prompt", message: prompt }),
      timeoutPromise,
      crashPromise,
    ]);
    if (ack.success === false) {
      clearTimeout(timer);
      return {
        output: "",
        timedOut: false,
        error: ack.error || "pi rejected prompt",
      };
    }
    const end = await Promise.race([agentEnd, timeoutPromise, crashPromise]);
    clearTimeout(timer);
    return finishPrompt(session, end);
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) {
      abortPiTurn(session);
      // Bounded grace: let the aborted turn drain (agent_end) so the next
      // new_session lands on an idle agent instead of a streaming one.
      await Promise.race([
        agentEnd,
        sleep(session.options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS),
        session.closed,
      ]);
      return { output: session.textBuffer, timedOut: true };
    }
    return { output: session.textBuffer, timedOut: false, error: String(err) };
  } finally {
    flushStreamLog(session);
  }
}

/**
 * Start a fresh pi conversation on the live process — the per-iteration
 * context reset. Throws if the process is gone or pi refuses, in which case
 * the caller should respawn via initPiSession.
 */
export async function resetPiSession(session: PiSession): Promise<void> {
  if (!session.process.pid || session.process.killed) {
    throw new Error("pi process is not running");
  }
  const ack = await Promise.race([
    sendPiCommand(session, { type: "new_session" }),
    rejectAfter(handshakeTimeout(session.options), "pi new_session timed out"),
    session.closed.then(({ code, signal }) => {
      throw crashError(session, code, signal);
    }),
  ]);
  if (ack.success === false) {
    throw new Error(ack.error || "pi new_session failed");
  }
  session.textBuffer = "";
  session.lastError = "";
}

export async function terminatePiSession(session: PiSession): Promise<void> {
  const child = session.process;
  if (!child.pid || child.killed) return;

  // Abort any in-flight turn before killing
  abortPiTurn(session);

  // Kill the entire process tree — pi tool subprocesses run in the same
  // process group and won't die from just killing the parent.
  const pid = child.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* process group may not exist */
  }
  child.kill("SIGTERM");

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && !child.killed) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already dead */
    }
    child.kill("SIGKILL");
  }
}

function buildPiArgs(opts: PiClientOptions): string[] {
  const args = ["--mode", "rpc", "--no-session"];
  if (opts.modelId) args.push("--model", opts.modelId);
  return [...args, ...opts.args];
}

function sendPiCommand(
  session: PiSession,
  command: Record<string, unknown>,
): Promise<PiRpcMessage> {
  const stdin = session.process.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded) {
    return Promise.reject(new Error("pi stdin is not writable"));
  }
  session.nextRequestId += 1;
  const id = `req-${session.nextRequestId}`;
  return new Promise<PiRpcMessage>((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    stdin.write(`${JSON.stringify({ id, ...command })}\n`, (err) => {
      if (err) {
        session.pending.delete(id);
        reject(err);
      }
    });
  });
}

/** Fire-and-forget abort of the in-flight turn; never throws. */
export function abortPiTurn(session: PiSession): void {
  sendPiCommand(session, { type: "abort" }).catch(() => {
    /* best-effort */
  });
}

/**
 * Fire-and-forget live steering: queue a message into the in-flight turn via
 * pi's `steer` command. Delivered after the current assistant turn finishes
 * its tool calls, before the next LLM call. Never throws.
 */
export function steerPiTurn(session: PiSession, message: string): void {
  sendPiCommand(session, { type: "steer", message }).catch(() => {
    /* best-effort */
  });
}

/**
 * Fetch token/cost totals for the current pi conversation. Best-effort with
 * its own short deadline — telemetry must never stall the loop.
 */
export async function getPiSessionStats(
  session: PiSession,
): Promise<PiUsageStats | undefined> {
  try {
    const ack = await Promise.race([
      sendPiCommand(session, { type: "get_session_stats" }),
      rejectAfter(STATS_TIMEOUT_MS, "pi get_session_stats timed out"),
      session.closed.then(({ code, signal }) => {
        throw crashError(session, code, signal);
      }),
    ]);
    if (ack.success === false) return undefined;
    return parseUsageStats(ack.data);
  } catch {
    return undefined;
  }
}

function parseUsageStats(data: unknown): PiUsageStats | undefined {
  const stats = data as
    | {
        tokens?: Record<string, number>;
        cost?: number;
        contextUsage?: { percent?: number | null };
      }
    | undefined;
  if (!stats?.tokens) return undefined;
  return {
    inputTokens: stats.tokens.input ?? 0,
    outputTokens: stats.tokens.output ?? 0,
    cacheReadTokens: stats.tokens.cacheRead ?? 0,
    cacheWriteTokens: stats.tokens.cacheWrite ?? 0,
    totalTokens: stats.tokens.total ?? 0,
    costUsd: stats.cost ?? 0,
    contextPercent: stats.contextUsage?.percent ?? undefined,
  };
}

function waitForAgentEnd(session: PiSession): Promise<PiRpcMessage> {
  return new Promise((resolve) => {
    session.agentEndWaiters.push(resolve);
  });
}

function finishPrompt(session: PiSession, end: PiRpcMessage): PiPromptResult {
  const output = session.textBuffer || agentEndText(end);
  const error = session.lastError || stopReasonError(end);
  if (error) return { output, timedOut: false, error };
  return { output, timedOut: false };
}

/**
 * Route one stdout JSONL record. RPC framing is strict LF-delimited JSON —
 * responses carry an `id`, events do not.
 */
function handlePiLine(session: PiSession, line: string): void {
  session.streamLines.push(line);

  let msg: PiRpcMessage;
  try {
    msg = JSON.parse(line) as PiRpcMessage;
  } catch {
    return; /* skip malformed */
  }

  if (msg.type === "response" && typeof msg.id === "string") {
    const pending = session.pending.get(msg.id);
    if (pending) {
      session.pending.delete(msg.id);
      pending.resolve(msg);
    }
    return;
  }

  if (msg.type === "message_update") {
    const delta = msg.assistantMessageEvent as
      | { type?: string; delta?: string; reason?: string }
      | undefined;
    if (delta?.type === "text_delta") {
      session.textBuffer += delta.delta ?? "";
    } else if (delta?.type === "error" && delta.reason) {
      session.lastError = delta.reason;
    }
  }

  if (session.options.verbose) {
    const text = formatPiStreamingEvent(msg);
    if (text) process.stderr.write(text);
  }

  if (msg.type === "agent_end") {
    const waiters = session.agentEndWaiters;
    session.agentEndWaiters = [];
    for (const waiter of waiters) waiter(msg);
  }
}

/** Last assistant message text from an agent_end event — streaming fallback. */
function agentEndText(end: PiRpcMessage): string {
  const messages = Array.isArray(end.messages) ? end.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: string;
      content?: { type?: string; text?: string }[];
    };
    if (message?.role !== "assistant") continue;
    const parts = Array.isArray(message.content) ? message.content : [];
    return parts
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }
  return "";
}

/** Error from the final assistant message's stopReason, if any. */
function stopReasonError(end: PiRpcMessage): string {
  const messages = Array.isArray(end.messages) ? end.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: string;
      stopReason?: string;
      errorMessage?: string;
    };
    if (message?.role !== "assistant") continue;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return message.errorMessage || `pi stopped: ${message.stopReason}`;
    }
    return "";
  }
  return "";
}

function handshakeTimeout(opts: PiClientOptions): number {
  return opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
}

/**
 * Persist the raw RPC traffic of the finished prompt — the pi equivalent of
 * the journal's backend output, but with full tool/thinking event fidelity.
 */
function flushStreamLog(session: PiSession): void {
  const path = session.streamLogPath;
  if (!path || session.streamLines.length === 0) return;
  try {
    writeFileSync(path, `${session.streamLines.join("\n")}\n`, "utf-8");
  } catch {
    /* logging must never fail the iteration */
  }
  session.streamLines = [];
}

function crashError(
  session: PiSession,
  code: number | null,
  signal: string | null,
): Error {
  const stderr = session.stderrBuffer.trim();
  const detail = stderr ? `\n${stderr}` : "";
  return new Error(
    `pi exited unexpectedly: code=${code} signal=${signal}${detail}`,
  );
}

/**
 * Strict JSONL reader per pi's RPC framing rules: split on LF only, strip a
 * trailing CR. (Node readline is not protocol-compliant — it also splits on
 * U+2028/U+2029, which are valid inside JSON strings.)
 */
function attachJsonlReader(
  child: ChildProcess,
  onLine: (line: string) => void,
): void {
  const stdout = child.stdout;
  if (!stdout) return;
  let buffer = "";
  const decoder = new TextDecoder();

  const emit = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim()) onLine(line);
  };

  stdout.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      emit(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  stdout.on("end", () => {
    buffer += decoder.decode();
    if (buffer) emit(buffer);
  });
}
