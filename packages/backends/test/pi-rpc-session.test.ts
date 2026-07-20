import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPiIteration } from "@mobrienv/autoloop-backends";
import {
  abortPiTurn,
  formatPiStreamingEvent,
  getPiSessionStats,
  initPiSession,
  type PiSession,
  resetPiSession,
  sendPiPrompt,
  steerPiTurn,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockChild extends ChildProcess {
  sent: Record<string, unknown>[];
  pushLine: (msg: Record<string, unknown> | string) => void;
  autoRespond: boolean;
  failCommands: Set<string>;
  responseData: Record<string, unknown>;
}

let lastChild: MockChild;

vi.mock("node:child_process", () => {
  const EventEmitter = require("node:events");
  const { Readable, Writable } = require("node:stream");

  function createMockChild(): ChildProcess {
    const child = new EventEmitter() as MockChild;
    child.sent = [];
    child.autoRespond =
      ((globalThis as Record<string, unknown>).__piAutoRespond as
        | boolean
        | undefined) ?? true;
    child.failCommands = new Set();
    child.responseData = {};
    child.pushLine = (msg) => {
      const line = typeof msg === "string" ? msg : JSON.stringify(msg);
      (child.stdout as { push: (chunk: string) => void }).push(`${line}\n`);
    };
    child.stdin = new Writable({
      write(chunk: Buffer, _e: unknown, cb: () => void) {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue;
          const cmd = JSON.parse(line) as Record<string, unknown>;
          child.sent.push(cmd);
          if (child.autoRespond && cmd.id) {
            const success = !child.failCommands.has(String(cmd.type));
            const data = child.responseData[String(cmd.type)];
            child.pushLine({
              type: "response",
              id: cmd.id,
              command: cmd.type,
              success,
              ...(data === undefined ? {} : { data }),
              ...(success ? {} : { error: `${cmd.type} refused` }),
            });
          }
        }
        cb();
      },
    });
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.pid = 23456;
    child.killed = false;
    child.kill = vi.fn(() => {
      child.killed = true;
      process.nextTick(() => {
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
      });
      return true;
    });
    return child;
  }

  return {
    spawn: vi.fn(() => {
      const child = createMockChild();
      (globalThis as Record<string, unknown>).__lastPiMockChild = child;
      return child;
    }),
  };
});

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function startSession(
  opts: Partial<Parameters<typeof initPiSession>[0]> = {},
): Promise<PiSession> {
  const session = await initPiSession({
    command: "pi",
    args: [],
    cwd: "/tmp",
    handshakeTimeoutMs: 1000,
    abortGraceMs: 20,
    ...opts,
  });
  lastChild = (globalThis as Record<string, unknown>)
    .__lastPiMockChild as MockChild;
  return session;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initPiSession", () => {
  it("spawns pi in RPC mode, detached, and handshakes via get_state", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    await startSession({ args: ["--thinking", "high"], modelId: "gpt-5" });

    expect(spawnFn).toHaveBeenCalledWith(
      "pi",
      [
        "--mode",
        "rpc",
        "--no-session",
        "--model",
        "gpt-5",
        "--thinking",
        "high",
      ],
      expect.objectContaining({ detached: true, cwd: "/tmp" }),
    );
    expect(lastChild.sent[0]).toMatchObject({ type: "get_state" });
  });

  it("rejects when the process dies before the handshake completes", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    (globalThis as Record<string, unknown>).__piAutoRespond = false;
    try {
      const pending = initPiSession({ command: "pi", args: [], cwd: "/tmp" });
      const child = (globalThis as Record<string, unknown>)
        .__lastPiMockChild as MockChild;
      child.stderr?.push("boom: command exploded\n");
      await settle();
      child.emit("close", 1, null);

      await expect(pending).rejects.toThrow(/pi exited unexpectedly: code=1/);
      await expect(pending).rejects.toThrow(/boom: command exploded/);
    } finally {
      (globalThis as Record<string, unknown>).__piAutoRespond = true;
      killSpy.mockRestore();
    }
  });

  it("times out a wedged handshake and reaps the orphan process", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    (globalThis as Record<string, unknown>).__piAutoRespond = false;
    try {
      const pending = initPiSession({
        command: "pi",
        args: [],
        cwd: "/tmp",
        handshakeTimeoutMs: 30,
      });

      await expect(pending).rejects.toThrow("pi RPC handshake timed out");
      const child = (globalThis as Record<string, unknown>)
        .__lastPiMockChild as MockChild;
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      (globalThis as Record<string, unknown>).__piAutoRespond = true;
      killSpy.mockRestore();
    }
  });

  it("caps the retained stderr buffer on the long-lived process", async () => {
    const session = await startSession();
    lastChild.stderr?.push("x".repeat(100 * 1024));
    await settle();

    expect(session.stderrBuffer.length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe("sendPiPrompt", () => {
  it("accumulates streamed text deltas until agent_end", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "do the thing", 5000);
    await settle();

    expect(session.process).toBe(lastChild);
    expect(lastChild.sent.at(-1)).toMatchObject({
      type: "prompt",
      message: "do the thing",
    });
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    });
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    lastChild.pushLine({ type: "agent_end", messages: [] });

    const result = await pending;
    expect(result).toEqual({ output: "Hello world", timedOut: false });
  });

  it("falls back to the agent_end assistant message when nothing streamed", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "quiet run", 5000);
    await settle();
    lastChild.pushLine({
      type: "agent_end",
      messages: [
        { role: "user", content: "quiet run" },
        {
          role: "assistant",
          stopReason: "stop",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "DONE" },
          ],
        },
        { role: "toolResult", content: [{ type: "text", text: "noise" }] },
      ],
    });

    const result = await pending;
    expect(result.output).toBe("DONE");
    expect(result.error).toBeUndefined();
  });

  it("surfaces streaming error events as failures", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "fail please", 5000);
    await settle();
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "error", reason: "quota exceeded" },
    });
    lastChild.pushLine({ type: "agent_end", messages: [] });

    const result = await pending;
    expect(result.error).toBe("quota exceeded");
  });

  it("treats an error stopReason on the final assistant message as failure", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "hi", 5000);
    await settle();
    lastChild.pushLine({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "overloaded",
          content: [{ type: "text", text: "partial" }],
        },
      ],
    });

    const result = await pending;
    expect(result.output).toBe("partial");
    expect(result.error).toBe("overloaded");
  });

  it("aborts the turn and returns partial output on timeout", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "slow", 30);
    await settle();
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "partial..." },
    });

    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.output).toBe("partial...");
    await settle();
    expect(lastChild.sent.at(-1)).toMatchObject({ type: "abort" });
  });

  it("returns the RPC error when pi rejects the prompt", async () => {
    const session = await startSession();
    lastChild.failCommands.add("prompt");

    const result = await sendPiPrompt(session, "nope", 5000);
    expect(result).toEqual({
      output: "",
      timedOut: false,
      error: "prompt refused",
    });
  });

  it("reports a crash mid-prompt with stderr detail", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "boom", 5000);
    await settle();
    lastChild.stderr?.push("segfault details\n");
    await settle();
    lastChild.emit("close", 137, "SIGKILL");

    const result = await pending;
    expect(result.error).toContain("pi exited unexpectedly: code=137");
    expect(result.error).toContain("segfault details");
  });
});

describe("resetPiSession", () => {
  it("starts a new conversation and clears session buffers", async () => {
    const session = await startSession();
    session.textBuffer = "stale";
    session.lastError = "stale error";

    await resetPiSession(session);

    expect(lastChild.sent.at(-1)).toMatchObject({ type: "new_session" });
    expect(session.textBuffer).toBe("");
    expect(session.lastError).toBe("");
  });

  it("throws when pi refuses the new session", async () => {
    const session = await startSession();
    lastChild.failCommands.add("new_session");

    await expect(resetPiSession(session)).rejects.toThrow(
      "new_session refused",
    );
  });

  it("throws when the process is no longer running", async () => {
    const session = await startSession();
    session.process.kill("SIGTERM");
    await settle();

    await expect(resetPiSession(session)).rejects.toThrow(
      "pi process is not running",
    );
  });

  it("times out when pi never answers the reset", async () => {
    const session = await startSession({ handshakeTimeoutMs: 30 });
    lastChild.autoRespond = false;

    await expect(resetPiSession(session)).rejects.toThrow(
      "pi new_session timed out",
    );
  });
});

describe("terminatePiSession", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("aborts the turn and SIGTERMs the process group", async () => {
    const session = await startSession();

    await terminatePiSession(session);

    expect(killSpy).toHaveBeenCalledWith(-23456, "SIGTERM");
    expect(session.process.kill).toHaveBeenCalledWith("SIGTERM");
    const aborts = lastChild.sent.filter((cmd) => cmd.type === "abort");
    expect(aborts).toHaveLength(1);
  });

  it("is a no-op for an already-dead process", async () => {
    const session = await startSession();
    session.process.kill("SIGTERM");
    await settle();
    (session.process.kill as ReturnType<typeof vi.fn>).mockClear();

    await terminatePiSession(session);

    expect(session.process.kill).not.toHaveBeenCalled();
  });
});

describe("RPC framing", () => {
  it("handles chunk-split lines, CRLF, and malformed JSON", async () => {
    const session = await startSession();
    const pending = sendPiPrompt(session, "framing", 5000);
    await settle();

    const stdout = lastChild.stdout as { push: (chunk: string) => void };
    stdout.push('{"type":"message_update","assistantMessageEvent"');
    stdout.push(':{"type":"text_delta","delta":"split"}}\r\n');
    stdout.push("not json at all\n");
    stdout.push('{"type":"agent_end","messages":[]}\n');

    const result = await pending;
    expect(result.output).toBe("split");
  });
});

describe("steerPiTurn", () => {
  it("queues a steer command for the in-flight turn", async () => {
    const session = await startSession();

    steerPiTurn(session, "focus on the failing test");
    await settle();

    expect(lastChild.sent.at(-1)).toMatchObject({
      type: "steer",
      message: "focus on the failing test",
    });
  });

  it("never throws even when stdin is gone", async () => {
    const session = await startSession();
    session.process.stdin?.destroy();
    await settle();

    expect(() => steerPiTurn(session, "anything")).not.toThrow();
  });
});

describe("getPiSessionStats", () => {
  it("parses token and cost totals from get_session_stats", async () => {
    const session = await startSession();
    lastChild.responseData.get_session_stats = {
      tokens: {
        input: 100,
        output: 40,
        cacheRead: 5,
        cacheWrite: 7,
        total: 152,
      },
      cost: 0.42,
      contextUsage: { percent: 31 },
    };

    await expect(getPiSessionStats(session)).resolves.toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      totalTokens: 152,
      costUsd: 0.42,
      contextPercent: 31,
    });
  });

  it("returns undefined when pi refuses or returns no token data", async () => {
    const session = await startSession();
    lastChild.failCommands.add("get_session_stats");
    await expect(getPiSessionStats(session)).resolves.toBeUndefined();

    lastChild.failCommands.delete("get_session_stats");
    await expect(getPiSessionStats(session)).resolves.toBeUndefined();
  });
});

describe("stream logging", () => {
  it("flushes complete size-batched records mid-prompt without duplication", async () => {
    const session = await startSession();
    const logPath = join(
      tmpdir(),
      `pi-stream-test-${process.pid}-${Date.now()}.jsonl`,
    );
    const delta = {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "x".repeat(64 * 1024),
      },
    };
    const end = { type: "agent_end", messages: [] };

    const pending = runPiIteration(session, "log me", 5000, logPath);
    await settle();
    lastChild.pushLine(delta);
    await settle();

    const midPrompt = readFileSync(logPath, "utf-8");
    expect(midPrompt.endsWith("\n")).toBe(true);
    const midRecords = midPrompt.trim().split("\n").map(JSON.parse);
    expect(midRecords).toEqual([
      {
        type: "response",
        id: "req-2",
        command: "prompt",
        success: true,
      },
      delta,
    ]);

    lastChild.pushLine(end);
    await pending;
    const finalLog = readFileSync(logPath, "utf-8");
    const finalRecords = finalLog.trim().split("\n").map(JSON.parse);
    expect(finalRecords).toEqual([...midRecords, end]);

    session.streamLastFlushAt = 0;
    lastChild.responseData.get_session_stats = { tokens: { total: 1 } };
    await getPiSessionStats(session);
    expect(readFileSync(logPath, "utf-8")).toBe(finalLog);
  });
});

describe("runPiIteration", () => {
  it("maps prompt results into the uniform backend result shape", async () => {
    const session = await startSession();
    const pending = runPiIteration(session, "iterate", 5000);
    await settle();
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "OK" },
    });
    lastChild.pushLine({ type: "agent_end", messages: [] });

    await expect(pending).resolves.toEqual({
      output: "OK",
      exitCode: 0,
      timedOut: false,
      providerKind: "pi",
      errorCategory: "none",
    });
  });

  it("maps failures and timeouts to error categories", async () => {
    const session = await startSession();
    lastChild.failCommands.add("prompt");
    await expect(runPiIteration(session, "x", 5000)).resolves.toMatchObject({
      exitCode: 1,
      errorCategory: "non_zero_exit",
    });

    lastChild.failCommands.delete("prompt");
    await expect(runPiIteration(session, "y", 20)).resolves.toMatchObject({
      exitCode: 0,
      timedOut: true,
      errorCategory: "timeout",
    });
  });

  it("keeps the error detail in the journaled output on failure", async () => {
    const session = await startSession();
    const pending = runPiIteration(session, "fail", 5000);
    await settle();
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "partial work" },
    });
    lastChild.pushLine({
      type: "message_update",
      assistantMessageEvent: { type: "error", reason: "quota exceeded" },
    });
    lastChild.pushLine({ type: "agent_end", messages: [] });

    const result = await pending;
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("partial work\n\npi error: quota exceeded");
  });
});

describe("abortPiTurn", () => {
  it("never throws even when stdin is gone", async () => {
    const session = await startSession();
    session.process.stdin?.destroy();
    await settle();

    expect(() => abortPiTurn(session)).not.toThrow();
  });
});

describe("formatPiStreamingEvent", () => {
  it("formats deltas and tool lifecycle, silences the rest", () => {
    expect(
      formatPiStreamingEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hi" },
      }),
    ).toBe("hi");
    expect(
      formatPiStreamingEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta" },
      }),
    ).toBeNull();
    expect(
      formatPiStreamingEvent({
        type: "tool_execution_start",
        toolName: "bash",
      }),
    ).toBe("[tool:bash]\n");
    expect(
      formatPiStreamingEvent({ type: "tool_execution_end", toolName: "bash" }),
    ).toBe("[tool:✓] bash\n");
    expect(
      formatPiStreamingEvent({
        type: "tool_execution_end",
        toolName: "bash",
        isError: true,
      }),
    ).toBe("[tool:✗] bash\n");
    expect(formatPiStreamingEvent({ type: "queue_update" })).toBeNull();
  });

  it("streams verbose output to stderr when enabled", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const session = await startSession({ verbose: true });
      const pending = sendPiPrompt(session, "verbose", 5000);
      await settle();
      lastChild.pushLine({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "loud" },
      });
      lastChild.pushLine({ type: "agent_end", messages: [] });
      await pending;

      expect(stderrSpy).toHaveBeenCalledWith("loud");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
