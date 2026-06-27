import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeSdkIteration } from "@mobrienv/autoloop-backends";
import {
  abortClaudeSdkTurn,
  type ClaudeSdkSession,
  formatClaudeSdkStreamingEvent,
  getClaudeSdkUsage,
  initClaudeSdkSession,
  sendClaudeSdkPrompt,
  steerClaudeSdkTurn,
  terminateClaudeSdkSession,
} from "@mobrienv/autoloop-backends/claude-sdk-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockQuery {
  /** User messages the SDK pulled from the streaming-input iterable. */
  received: Record<string, unknown>[];
  /** Options object the query was created with. */
  options: Record<string, unknown>;
  emit: (msg: Record<string, unknown>) => void;
  endStream: () => void;
  interrupt: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  initializationResult: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

let lastQuery: MockQuery;

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  function createMockQuery(params: {
    prompt: AsyncIterable<Record<string, unknown>>;
    options: Record<string, unknown>;
  }): MockQuery {
    const queue: Record<string, unknown>[] = [];
    const waiters: ((r: IteratorResult<unknown>) => void)[] = [];
    let ended = false;
    let resolveInit: (value: Record<string, unknown>) => void = () => {};
    const initPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveInit = resolve;
    });

    const q: MockQuery = {
      received: [],
      options: params.options,
      emit(msg) {
        const waiter = waiters.shift();
        if (waiter) waiter({ value: msg, done: false });
        else queue.push(msg);
      },
      endStream() {
        ended = true;
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined, done: true });
        }
      },
      interrupt: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
      initializationResult: vi.fn(() => initPromise),
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<unknown>> => {
            const queued = queue.shift();
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false });
            }
            if (ended) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => waiters.push(resolve));
          },
        };
      },
    };

    // Drain the streaming input so tests can assert what the harness sent.
    void (async () => {
      for await (const msg of params.prompt) {
        q.received.push(msg);
      }
    })();

    if (!(globalThis as Record<string, unknown>).__claudeSdkNoAutoInit) {
      resolveInit({ commands: [], models: [] });
    }
    return q;
  }

  return {
    query: vi.fn(
      (params: {
        prompt: AsyncIterable<Record<string, unknown>>;
        options: Record<string, unknown>;
      }) => {
        const q = createMockQuery(params);
        (globalThis as Record<string, unknown>).__lastClaudeSdkMockQuery = q;
        return q;
      },
    ),
  };
});

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startSession(
  opts: Partial<Parameters<typeof initClaudeSdkSession>[0]> = {},
): Promise<ClaudeSdkSession> {
  const session = await initClaudeSdkSession({
    cwd: "/tmp",
    trustAllTools: true,
    handshakeTimeoutMs: 1000,
    interruptGraceMs: 50,
    ...opts,
  });
  lastQuery = await awaitMockQuery();
  return session;
}

function assistantMsg(
  text: string,
  tools: string[] = [],
): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...tools.map((name) => ({ type: "tool_use", name, id: "tu-1" })),
      ],
    },
    session_id: "sess-1",
  };
}

function resultMsg(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    result: "final text",
    total_cost_usd: 0.42,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 20,
    },
    duration_ms: 1234,
    session_id: "sess-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).__claudeSdkNoAutoInit = false;
  (globalThis as Record<string, unknown>).__lastClaudeSdkMockQuery = undefined;
});

/** Wait for the lazy SDK import + query() call to produce the mock. */
async function awaitMockQuery(): Promise<MockQuery> {
  // Time-based deadline, not a fixed tick count: on a loaded CI runner the
  // module transform behind the lazy import can outlast any number of bare
  // setImmediate turns.
  const deadline = Date.now() + 2000;
  while (true) {
    const q = (globalThis as Record<string, unknown>)
      .__lastClaudeSdkMockQuery as MockQuery | undefined;
    if (q) return q;
    if (Date.now() >= deadline) break;
    await settle();
    await sleep(5);
  }
  throw new Error("mock query was never created");
}

describe("initClaudeSdkSession", () => {
  it("maps autoloop config onto SDK options", async () => {
    await startSession({
      command: "/opt/claude/bin/claude",
      model: "claude-opus-4-8",
      cwd: "/work",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(lastQuery.options).toMatchObject({
      cwd: "/work",
      model: "claude-opus-4-8",
      pathToClaudeCodeExecutable: "/opt/claude/bin/claude",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["project"],
      includePartialMessages: false,
    });
    expect(lastQuery.options.abortController).toBeInstanceOf(AbortController);
  });

  it("keeps default permissions when tools are not trusted", async () => {
    await startSession({ trustAllTools: false });
    expect(lastQuery.options.permissionMode).toBeUndefined();
    expect(lastQuery.options.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("registers the hard-deny floor as a PreToolUse hook even under bypassPermissions", async () => {
    await startSession({ trustAllTools: true });
    expect(lastQuery.options.permissionMode).toBe("bypassPermissions");
    const hooks = lastQuery.options.hooks as
      | { PreToolUse?: Array<{ hooks: unknown[] }> }
      | undefined;
    expect(hooks?.PreToolUse?.length).toBeGreaterThan(0);
    expect(hooks?.PreToolUse?.[0]?.hooks?.length).toBeGreaterThan(0);
  });

  it("registers the floor even when tools are not trusted", async () => {
    await startSession({ trustAllTools: false });
    const hooks = lastQuery.options.hooks as
      | { PreToolUse?: unknown[] }
      | undefined;
    expect(hooks?.PreToolUse?.length).toBeGreaterThan(0);
  });

  it("omits executable path for the bare claude command", async () => {
    await startSession({});
    expect(lastQuery.options.pathToClaudeCodeExecutable).toBeUndefined();
    expect(lastQuery.options.model).toBeUndefined();
  });

  it("fails the handshake when no init message arrives in time", async () => {
    (globalThis as Record<string, unknown>).__claudeSdkNoAutoInit = true;
    await expect(
      initClaudeSdkSession({
        cwd: "/tmp",
        trustAllTools: true,
        handshakeTimeoutMs: 20,
      }),
    ).rejects.toThrow(/handshake timed out/);
    const q = (globalThis as Record<string, unknown>)
      .__lastClaudeSdkMockQuery as MockQuery;
    expect(q.close).toHaveBeenCalled();
  });

  it("fails the handshake when the stream ends before init", async () => {
    (globalThis as Record<string, unknown>).__claudeSdkNoAutoInit = true;
    const pending = initClaudeSdkSession({
      cwd: "/tmp",
      trustAllTools: true,
      handshakeTimeoutMs: 1000,
    });
    pending.catch(() => {
      /* inspected below — avoid unhandled rejection between ticks */
    });
    const q = await awaitMockQuery();
    q.endStream();
    await expect(pending).rejects.toThrow(/exited before completing init/);
  });
});

describe("sendClaudeSdkPrompt", () => {
  it("pushes the prompt as a user message and accumulates assistant text", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "do the thing", 5000);
    await settle();
    expect(lastQuery.received.at(-1)).toMatchObject({
      type: "user",
      message: { role: "user", content: "do the thing" },
      parent_tool_use_id: null,
    });

    lastQuery.emit(assistantMsg("Hello "));
    lastQuery.emit(assistantMsg("world"));
    lastQuery.emit(resultMsg());
    const result = await pending;
    expect(result).toEqual({ output: "Hello world", timedOut: false });
  });

  it("falls back to the result text when no assistant text streamed", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "quiet", 5000);
    await settle();
    lastQuery.emit(resultMsg({ result: "from result" }));
    const result = await pending;
    expect(result.output).toBe("from result");
  });

  it("surfaces error results with their detail", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "fail", 5000);
    await settle();
    lastQuery.emit(assistantMsg("partial"));
    lastQuery.emit(
      resultMsg({
        subtype: "error_during_execution",
        is_error: true,
        errors: ["boom"],
      }),
    );
    const result = await pending;
    expect(result.output).toBe("partial");
    expect(result.error).toBe("boom");
  });

  it("labels error results without detail by their subtype", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "fail", 5000);
    await settle();
    lastQuery.emit(resultMsg({ subtype: "error_max_turns", is_error: true }));
    const result = await pending;
    expect(result.error).toBe("claude-sdk stopped: error_max_turns");
  });

  it("returns an error when the stream ends mid-turn", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "crash", 5000);
    await settle();
    lastQuery.emit(assistantMsg("partial"));
    await settle();
    lastQuery.endStream();
    const result = await pending;
    expect(result.output).toBe("partial");
    expect(result.error).toMatch(/ended unexpectedly/);
  });

  it("interrupts on timeout and captures drained partial output", async () => {
    const session = await startSession({ interruptGraceMs: 200 });
    const pending = sendClaudeSdkPrompt(session, "slow", 30);
    await settle();
    await sleep(40); // let the timeout fire
    expect(lastQuery.interrupt).toHaveBeenCalled();
    lastQuery.emit(assistantMsg("got this far"));
    lastQuery.emit(resultMsg({ result: "" }));
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.output).toBe("got this far");
  });

  it("gives up after the interrupt grace period", async () => {
    const session = await startSession({ interruptGraceMs: 20 });
    const pending = sendClaudeSdkPrompt(session, "wedged", 30);
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.output).toBe("");
    expect(lastQuery.interrupt).toHaveBeenCalled();
  });
});

describe("steerClaudeSdkTurn", () => {
  it("queues a steer message into the in-flight turn", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "work", 5000);
    await settle();
    steerClaudeSdkTurn(session, "focus on the failing test");
    await settle();
    expect(lastQuery.received.at(-1)).toMatchObject({
      type: "user",
      message: { role: "user", content: "focus on the failing test" },
    });
    lastQuery.emit(resultMsg()); // consumed by the pending-steer race guard
    lastQuery.emit(resultMsg({ result: "steered" }));
    const result = await pending;
    expect(result.timedOut).toBe(false);
  });

  it("keeps waiting for the steered turn's result", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "work", 5000);
    await settle();
    steerClaudeSdkTurn(session, "also do X");
    lastQuery.emit(assistantMsg("first "));
    lastQuery.emit(resultMsg());
    await settle();
    // One result consumed by the steer guard — the prompt is still pending.
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await settle();
    expect(resolved).toBe(false);
    lastQuery.emit(assistantMsg("second"));
    lastQuery.emit(resultMsg());
    const result = await pending;
    expect(result.output).toBe("first second");
  });

  it("is a no-op when no turn is in flight", async () => {
    const session = await startSession();
    const before = lastQuery.received.length;
    steerClaudeSdkTurn(session, "ignored");
    await settle();
    expect(lastQuery.received.length).toBe(before);
    expect(session.pendingSteers).toBe(0);
  });
});

describe("abortClaudeSdkTurn", () => {
  it("fires interrupt without throwing", async () => {
    const session = await startSession();
    lastQuery.interrupt.mockReturnValueOnce(Promise.reject(new Error("nope")));
    expect(() => abortClaudeSdkTurn(session)).not.toThrow();
    await settle();
    expect(lastQuery.interrupt).toHaveBeenCalled();
  });
});

describe("terminateClaudeSdkSession", () => {
  it("ends input, closes the query, and aborts as backstop", async () => {
    const session = await startSession();
    await terminateClaudeSdkSession(session);
    expect(lastQuery.close).toHaveBeenCalledTimes(1);
    const controller = lastQuery.options.abortController as AbortController;
    expect(controller.signal.aborted).toBe(true);
  });

  it("is idempotent", async () => {
    const session = await startSession();
    await terminateClaudeSdkSession(session);
    await terminateClaudeSdkSession(session);
    expect(lastQuery.close).toHaveBeenCalledTimes(1);
  });
});

describe("getClaudeSdkUsage", () => {
  it("maps the result usage onto the journal stats shape", async () => {
    const session = await startSession();
    const pending = sendClaudeSdkPrompt(session, "go", 5000);
    await settle();
    lastQuery.emit(resultMsg());
    await pending;
    expect(getClaudeSdkUsage(session)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
      totalTokens: 200,
      costUsd: 0.42,
    });
  });

  it("returns undefined before any result", async () => {
    const session = await startSession();
    expect(getClaudeSdkUsage(session)).toBeUndefined();
  });
});

describe("runClaudeSdkIteration", () => {
  it("maps success onto the uniform BackendRunResult shape", async () => {
    const session = await startSession();
    const pending = runClaudeSdkIteration(session, "go", 5000);
    await settle();
    lastQuery.emit(assistantMsg("done"));
    lastQuery.emit(resultMsg());
    expect(await pending).toEqual({
      output: "done",
      exitCode: 0,
      timedOut: false,
      providerKind: "claude-sdk",
      errorCategory: "none",
    });
  });

  it("maps errors with detail-preserving output", async () => {
    const session = await startSession();
    const pending = runClaudeSdkIteration(session, "go", 5000);
    await settle();
    lastQuery.emit(assistantMsg("partial"));
    lastQuery.emit(
      resultMsg({
        subtype: "error_during_execution",
        is_error: true,
        errors: ["exploded"],
      }),
    );
    expect(await pending).toEqual({
      output: "partial\n\nclaude-sdk error: exploded",
      exitCode: 1,
      timedOut: false,
      providerKind: "claude-sdk",
      errorCategory: "non_zero_exit",
    });
  });

  it("persists the raw message stream to the log path", async () => {
    const session = await startSession();
    const logPath = join(
      tmpdir(),
      `claude-stream-test-${process.pid}-${Date.now()}.jsonl`,
    );
    const pending = runClaudeSdkIteration(session, "go", 5000, logPath);
    await settle();
    lastQuery.emit(assistantMsg("hi"));
    lastQuery.emit(resultMsg());
    await pending;
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toEqual(["assistant", "result"]);
  });
});

describe("formatClaudeSdkStreamingEvent", () => {
  it("formats partial text deltas", () => {
    const text = formatClaudeSdkStreamingEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "chunk" },
      },
    } as never);
    expect(text).toBe("chunk");
  });

  it("formats assistant tool_use blocks as markers", () => {
    const text = formatClaudeSdkStreamingEvent(
      assistantMsg("", ["Bash"]) as never,
    );
    expect(text).toBe("[tool:Bash]\n");
  });

  it("silences other messages", () => {
    expect(formatClaudeSdkStreamingEvent(resultMsg() as never)).toBeNull();
  });
});
