import { writeFileSync } from "node:fs";
import type {
  HookInput,
  HookJSONOutput,
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  commandFloorDecision,
  extractCommandFromToolInput,
} from "./command-risk.js";

export interface ClaudeSdkClientOptions {
  /** Path to the Claude Code executable when it isn't the bare `claude` on PATH. */
  command?: string;
  model?: string;
  cwd: string;
  trustAllTools: boolean;
  verbose?: boolean;
  /** Deadline for the SDK init handshake (default 30s). */
  handshakeTimeoutMs?: number;
  /** How long a timed-out turn may drain after interrupt() before the session is abandoned (default 2s). */
  interruptGraceMs?: number;
  env?: Record<string, string | undefined>;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_INTERRUPT_GRACE_MS = 2_000;

/**
 * PreToolUse hard-deny floor. Denies a tool call whose command classifies as
 * catastrophic; otherwise stays out of the way (returns an empty result so the
 * configured permission mode decides). Non-overridable by design.
 */
export async function commandRiskHook(
  input: HookInput,
): Promise<HookJSONOutput> {
  if (input.hook_event_name !== "PreToolUse") return {};
  const command = extractCommandFromToolInput(input.tool_input);
  if (command === null) return {};
  const risk = commandFloorDecision(command);
  if (!risk.catastrophic) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Blocked by autoloop safety floor [${risk.rule}]: ${risk.reason}`,
    },
  };
}

export interface ClaudeSdkSession {
  query: Query;
  /** Single consume path for the query generator, shared by handshake and prompt loop. */
  iterator: AsyncIterator<SDKMessage>;
  /**
   * The one in-flight iterator.next() promise. Consumers race it against
   * timeouts; sharing it means a raced-out pull is resumed by the next
   * consumer instead of orphaned (which would silently drop a message).
   */
  pendingNext?: Promise<IteratorResult<SDKMessage, void>>;
  input: PushableInput;
  abortController: AbortController;
  options: ClaudeSdkClientOptions;
  /** True while sendClaudeSdkPrompt is consuming a turn — gates live steering. */
  turnActive: boolean;
  /** Steers pushed into the in-flight turn whose follow-up result we must still await. */
  pendingSteers: number;
  textBuffer: string;
  lastError: string;
  /** Final result message of the last prompt — the usage/cost telemetry source. */
  lastResult?: SDKResultMessage;
  closed: boolean;
  /** Raw SDK messages for the in-flight prompt, flushed to streamLogPath. */
  streamLines: string[];
  /** Where to persist the raw message stream for the current prompt, if anywhere. */
  streamLogPath?: string;
}

export interface ClaudeSdkPromptResult {
  output: string;
  timedOut: boolean;
  error?: string;
}

/** Per-iteration usage totals from the SDK's final result message. */
export interface ClaudeSdkUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
}

/**
 * Async queue used as the query() prompt iterable. Keeping the input as a
 * pushable stream is what puts the SDK in streaming-input mode, which is the
 * mode that supports interrupt() and mid-turn user-message injection.
 */
class PushableInput implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiters: ((result: IteratorResult<SDKUserMessage>) => void)[] = [];
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queue.push(message);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined, done: true });
    }
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.queue.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Start a Claude Agent SDK query in streaming-input mode and wait for the
 * init handshake. One query is one conversation, so the harness creates a
 * fresh session per iteration — each role gets a clean context window — and
 * live control (interrupt/steer) targets the session active that iteration.
 *
 * The SDK is loaded lazily so backends that never use claude-sdk don't pay
 * its import cost.
 */
export async function initClaudeSdkSession(
  opts: ClaudeSdkClientOptions,
): Promise<ClaudeSdkSession> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const abortController = new AbortController();
  const input = new PushableInput();
  const options: Options = {
    cwd: opts.cwd,
    abortController,
    env: opts.env ?? process.env,
    // Parity with the legacy `claude -p` shell backend: the Claude Code
    // system prompt and project settings (CLAUDE.md) stay loaded.
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["project"],
    includePartialMessages: opts.verbose === true,
  };
  if (opts.model) options.model = opts.model;
  if (opts.command) options.pathToClaudeCodeExecutable = opts.command;
  if (opts.trustAllTools) {
    // Parity with the injected --dangerously-skip-permissions of the shell path.
    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;
  }
  // Harness-owned hard-deny floor. A PreToolUse hook runs before permission
  // resolution, so it denies catastrophic commands even under
  // bypassPermissions — and a preset cannot remove it.
  options.hooks = {
    ...options.hooks,
    PreToolUse: [
      ...(options.hooks?.PreToolUse ?? []),
      { hooks: [commandRiskHook] },
    ],
  };

  const q = query({ prompt: input, options });
  const session: ClaudeSdkSession = {
    query: q,
    iterator: q[Symbol.asyncIterator](),
    input,
    abortController,
    options: opts,
    turnActive: false,
    pendingSteers: 0,
    textBuffer: "",
    lastError: "",
    closed: false,
    streamLines: [],
  };

  // Handshake: the SDK's control-channel initialize round trip confirms the
  // CLI is up without waiting for the first turn (the `system/init` stream
  // message only arrives with the first turn in streaming-input mode). A
  // wedged spawn must not hang the loop — enforce a deadline, watch for the
  // stream ending early, and reap on failure.
  let handshakeDone = false;
  const watchEnd = (async (): Promise<void> => {
    while (!handshakeDone) {
      const next = await nextMessage(session);
      if (handshakeDone) return;
      if (next.done) {
        throw new Error(
          session.lastError || "claude-sdk exited before completing init",
        );
      }
      handleMessage(session, next.value);
    }
  })();
  watchEnd.catch(() => {
    /* observed via the race below; swallow late rejections */
  });
  try {
    await Promise.race([
      session.query.initializationResult().then(() => undefined),
      watchEnd,
      rejectAfter(
        opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
        "claude-sdk handshake timed out",
      ),
    ]);
  } catch (err) {
    handshakeDone = true;
    await terminateClaudeSdkSession(session).catch(() => {
      /* best-effort */
    });
    throw err;
  }
  handshakeDone = true;
  return session;
}

/**
 * Pull the next SDK message, reusing the in-flight pull if one exists. Never
 * call session.iterator.next() directly — a pull abandoned by a timeout race
 * must be picked up by the next consumer or its message is lost.
 */
function nextMessage(
  session: ClaudeSdkSession,
): Promise<IteratorResult<SDKMessage, void>> {
  const existing = session.pendingNext;
  if (existing) return existing;
  const pull = session.iterator.next() as Promise<
    IteratorResult<SDKMessage, void>
  >;
  session.pendingNext = pull;
  pull.then(
    () => {
      if (session.pendingNext === pull) session.pendingNext = undefined;
    },
    () => {
      // Also marks late rejections handled once every consumer is gone.
      if (session.pendingNext === pull) session.pendingNext = undefined;
    },
  );
  return pull;
}

/**
 * Send one autoloop iteration prompt and consume the stream until the final
 * result message. Output is the accumulated assistant text (with the result
 * text as fallback). On timeout the in-flight turn is interrupted and partial
 * output is returned.
 */
export async function sendClaudeSdkPrompt(
  session: ClaudeSdkSession,
  prompt: string,
  timeoutMs: number,
): Promise<ClaudeSdkPromptResult> {
  session.textBuffer = "";
  session.lastError = "";
  session.lastResult = undefined;
  session.streamLines = [];
  session.pendingSteers = 0;
  session.turnActive = true;

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("claude-sdk prompt timed out"));
    }, timeoutMs);
  });

  session.input.push(userMessage(prompt));
  try {
    await consumeUntilResult(session, timeoutPromise);
    clearTimeout(timer);
    return finishPrompt(session);
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) {
      abortClaudeSdkTurn(session);
      // Bounded grace: let the interrupted turn drain so partial output and
      // the result telemetry are captured before the session is abandoned.
      await Promise.race([
        drainAfterInterrupt(session),
        sleep(session.options.interruptGraceMs ?? DEFAULT_INTERRUPT_GRACE_MS),
      ]);
      return { output: session.textBuffer, timedOut: true };
    }
    return { output: session.textBuffer, timedOut: false, error: String(err) };
  } finally {
    session.turnActive = false;
    flushStreamLog(session);
  }
}

async function consumeUntilResult(
  session: ClaudeSdkSession,
  timeoutPromise: Promise<never>,
): Promise<void> {
  while (true) {
    const next = await Promise.race([nextMessage(session), timeoutPromise]);
    if (next.done) {
      throw new Error(
        session.lastError || "claude-sdk session ended unexpectedly",
      );
    }
    handleMessage(session, next.value);
    if (next.value.type === "result") {
      // A steer that landed after the turn ended starts a new turn in the
      // same query — keep consuming until the last steered turn resolves.
      if (session.pendingSteers > 0) {
        session.pendingSteers -= 1;
        continue;
      }
      return;
    }
  }
}

async function drainAfterInterrupt(session: ClaudeSdkSession): Promise<void> {
  try {
    while (true) {
      const next = await nextMessage(session);
      if (next.done) return;
      handleMessage(session, next.value);
      if (next.value.type === "result") return;
    }
  } catch {
    /* drain is best-effort */
  }
}

/** Fire-and-forget interrupt of the in-flight turn; never throws. */
export function abortClaudeSdkTurn(session: ClaudeSdkSession): void {
  session.query.interrupt().catch(() => {
    /* best-effort */
  });
}

/**
 * Fire-and-forget live steering: queue a user message into the in-flight
 * turn. The SDK delivers it as steering at the next safe boundary. No-op when
 * no turn is active — the journal-durable guidance copy still reaches the
 * next iteration's prompt. Never throws.
 */
export function steerClaudeSdkTurn(
  session: ClaudeSdkSession,
  message: string,
): void {
  if (!session.turnActive || session.closed) return;
  session.pendingSteers += 1;
  session.input.push(userMessage(message));
}

export async function terminateClaudeSdkSession(
  session: ClaudeSdkSession,
): Promise<void> {
  if (session.closed) return;
  session.closed = true;
  try {
    session.input.end();
  } catch {
    /* best-effort */
  }
  try {
    await Promise.race([
      session.query.interrupt().catch(() => {
        /* no turn in flight */
      }),
      sleep(1_000),
    ]);
  } catch {
    /* best-effort */
  }
  try {
    session.query.close();
  } catch {
    /* already closed */
  }
  // Backstop: make sure the underlying CLI process is gone.
  session.abortController.abort();
}

/** Usage totals from the last prompt's final result message, if any. */
export function getClaudeSdkUsage(
  session: ClaudeSdkSession,
): ClaudeSdkUsageStats | undefined {
  const result = session.lastResult;
  if (!result) return undefined;
  const usage = result.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: result.total_cost_usd ?? 0,
  };
}

/**
 * Format an SDK message for verbose stderr output.
 * Returns null for message types that should be silenced.
 */
export function formatClaudeSdkStreamingEvent(msg: SDKMessage): string | null {
  if (msg.type === "stream_event") {
    const event = msg.event as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta"
    ) {
      return event.delta.text ?? null;
    }
    return null;
  }
  if (msg.type === "assistant") {
    const blocks = assistantBlocks(msg);
    const tools = blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => `[tool:${(block as { name?: string }).name ?? "tool"}]\n`)
      .join("");
    return tools || null;
  }
  return null;
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function handleMessage(session: ClaudeSdkSession, msg: SDKMessage): void {
  try {
    session.streamLines.push(JSON.stringify(msg));
  } catch {
    /* unserializable message — skip the log line */
  }

  if (msg.type === "assistant") {
    // Accumulate full assistant messages only — verbose partial deltas would
    // double-count the same text.
    session.textBuffer += assistantText(msg);
  }

  if (msg.type === "result") {
    session.lastResult = msg;
    if (msg.subtype !== "success" || msg.is_error) {
      const errors =
        "errors" in msg && Array.isArray(msg.errors) ? msg.errors : [];
      session.lastError =
        errors.filter(Boolean).join("; ") ||
        (msg.subtype === "success"
          ? "claude-sdk reported an error result"
          : `claude-sdk stopped: ${msg.subtype}`);
    }
  }

  if (session.options.verbose) {
    const text = formatClaudeSdkStreamingEvent(msg);
    if (text) process.stderr.write(text);
  }
}

function assistantBlocks(
  msg: SDKAssistantMessage,
): { type?: string; text?: string }[] {
  const content = msg.message?.content;
  return Array.isArray(content) ? content : [];
}

function assistantText(msg: SDKAssistantMessage): string {
  return assistantBlocks(msg)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function finishPrompt(session: ClaudeSdkSession): ClaudeSdkPromptResult {
  const result = session.lastResult;
  const resultText =
    result && result.subtype === "success" ? result.result : "";
  const output = session.textBuffer || resultText;
  if (session.lastError) {
    return { output, timedOut: false, error: session.lastError };
  }
  return { output, timedOut: false };
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
 * Persist the raw SDK message traffic of the finished prompt — the claude-sdk
 * equivalent of the journal's backend output, but with full tool/thinking
 * event fidelity.
 */
function flushStreamLog(session: ClaudeSdkSession): void {
  const path = session.streamLogPath;
  if (!path || session.streamLines.length === 0) return;
  try {
    writeFileSync(path, `${session.streamLines.join("\n")}\n`, "utf-8");
  } catch {
    /* logging must never fail the iteration */
  }
  session.streamLines = [];
}
