import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPiIteration } from "@mobrienv/autoloop-backends";
import {
  abortPiTurn,
  formatPiStreamingEvent,
  getPiSessionStats,
  initPiSession,
  type PiSession,
  preparePiStreamRecord,
  resetPiSession,
  sendPiPrompt,
  steerPiTurn,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cumulativePiEvents } from "./fixtures/pi-cumulative-rpc.mjs";

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

interface LoggedCumulativeStream {
  bytes: number;
  records: Record<string, unknown>[];
}

async function logCumulativeStream(
  eventCount: number,
  payloadBytes = 384,
): Promise<LoggedCumulativeStream> {
  const directory = mkdtempSync(join(tmpdir(), "pi-cumulative-stream-"));
  const logPath = join(directory, "pi-stream.jsonl");
  try {
    const session = await startSession();
    const pending = runPiIteration(
      session,
      "exercise cumulative persistence",
      30_000,
      logPath,
    );
    await settle();
    for (const event of cumulativePiEvents(eventCount, payloadBytes)) {
      lastChild.pushLine(event);
    }
    await pending;

    const contents = readFileSync(logPath, "utf8");
    expect(contents.endsWith("\n")).toBe(true);
    return {
      bytes: statSync(logPath).size,
      records: contents
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  it("preserves cumulative lifecycle stream fidelity and source order exactly once", async () => {
    const eventCount = 258;
    const { records } = await logCumulativeStream(eventCount);
    const events = records.slice(1);

    expect(records[0]).toMatchObject({
      type: "response",
      command: "prompt",
      success: true,
    });
    expect(events).toHaveLength(eventCount);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: eventCount }, (_, sequence) => sequence),
    );
    expect(new Set(events.map((event) => event.sequence)).size).toBe(
      eventCount,
    );

    const assistantEnds = events.filter((event) => {
      const message = event.message as { role?: string } | undefined;
      return event.type === "message_end" && message?.role === "assistant";
    });
    expect(assistantEnds.length).toBeGreaterThan(20);
    expect(assistantEnds[0]).toMatchObject({
      message: {
        content: [
          { type: "thinking", thinking: "thinking-0" },
          { type: "text" },
          { type: "toolCall", id: "tool-0", name: "bash" },
        ],
      },
    });
    expect(
      events
        .filter(
          (event) => event.type === "message_end" || event.type === "turn_end",
        )
        .every((event) => !("messages" in event)),
    ).toBe(true);

    const thinkingDeltas = events.filter(
      (event) =>
        event.type === "message_update" &&
        (event.assistantMessageEvent as { type?: string } | undefined)?.type ===
          "thinking_delta",
    );
    const textDeltas = events.filter(
      (event) =>
        event.type === "message_update" &&
        (event.assistantMessageEvent as { type?: string } | undefined)?.type ===
          "text_delta",
    );
    expect(thinkingDeltas.length).toBeGreaterThan(20);
    expect(textDeltas.length).toBe(thinkingDeltas.length);

    const toolStarts = events.filter(
      (event) => event.type === "tool_execution_start",
    );
    const toolUpdates = events.filter(
      (event) => event.type === "tool_execution_update",
    );
    const toolEnds = events.filter(
      (event) => event.type === "tool_execution_end",
    );
    expect(toolStarts.length).toBeGreaterThan(20);
    expect(toolUpdates).toHaveLength(toolStarts.length);
    expect(toolEnds).toHaveLength(toolStarts.length);
    expect(toolEnds[0]).toMatchObject({
      toolCallId: "tool-0",
      toolName: "bash",
      result: { content: [{ type: "text", text: "result-0" }] },
      isError: false,
    });

    expect(events.at(-2)).toMatchObject({
      type: "message_update",
      assistantMessageEvent: {
        type: "error",
        reason: "synthetic final failure",
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "agent_end",
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          stopReason: "error",
          errorMessage: "synthetic final failure",
        }),
      ]),
    });
  });

  it("compacts only cumulative intermediate lifecycle snapshots", () => {
    const historicalMessages = [{ role: "user", content: "history" }];
    const currentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "current answer" }],
    };
    const messageEndLine = JSON.stringify({
      type: "message_end",
      sequence: 1,
      message: currentMessage,
      messages: historicalMessages,
    });
    const messageEnd = preparePiStreamRecord(messageEndLine);
    expect(JSON.parse(messageEnd.persistedLine)).toEqual({
      type: "message_end",
      sequence: 1,
      message: currentMessage,
    });
    expect(messageEnd.message?.messages).toEqual(historicalMessages);

    const turnEnd = preparePiStreamRecord(
      JSON.stringify({
        type: "turn_end",
        sequence: 2,
        messages: historicalMessages,
      }),
    );
    expect(JSON.parse(turnEnd.persistedLine)).toEqual({
      type: "turn_end",
      sequence: 2,
    });

    const agentEndLine = JSON.stringify({
      type: "agent_end",
      sequence: 3,
      messages: historicalMessages,
    });
    expect(preparePiStreamRecord(agentEndLine)).toEqual({
      message: JSON.parse(agentEndLine),
      persistedLine: agentEndLine,
    });

    const updateLine = JSON.stringify({
      type: "message_update",
      messages: historicalMessages,
      assistantMessageEvent: { type: "text_delta", delta: "kept" },
    });
    expect(preparePiStreamRecord(updateLine).persistedLine).toBe(updateLine);

    const nonSnapshotLine = JSON.stringify({
      type: "message_end",
      messages: "not a cumulative snapshot",
    });
    expect(preparePiStreamRecord(nonSnapshotLine).persistedLine).toBe(
      nonSnapshotLine,
    );
  });

  it("keeps malformed and non-object records observable without dispatching them", () => {
    expect(preparePiStreamRecord("not json")).toEqual({
      persistedLine: "not json",
    });
    expect(preparePiStreamRecord("null")).toEqual({ persistedLine: "null" });
    expect(preparePiStreamRecord("[]")).toEqual({ persistedLine: "[]" });
    expect(preparePiStreamRecord('"text"')).toEqual({
      persistedLine: '"text"',
    });
  });

  it("keeps cumulative stream persistence near-linear when the event count doubles", async () => {
    const small = await logCumulativeStream(256);
    const large = await logCumulativeStream(512);
    const ratio = large.bytes / small.bytes;
    console.info(
      `Pi cumulative growth: N=256 ${small.bytes} bytes; 2N=512 ${large.bytes} bytes; ratio=${ratio.toFixed(3)}`,
    );

    // Fixed framing can add a small constant, but 2.35x + 128 KiB leaves
    // ample room around linear 2x growth while deterministically rejecting 4x.
    expect(large.bytes).toBeLessThanOrEqual(small.bytes * 2.35 + 128 * 1024);
  });

  it("persists 4,400 events under a 256 MB child heap with a bounded log", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-stream-heap-"));
    const logPath = join(directory, "pi-stream.jsonl");
    const runnerPath = join(
      process.cwd(),
      "packages/backends/test/fixtures/pi-stream-heap-runner.ts",
    );
    const rpcPath = join(
      process.cwd(),
      "packages/backends/test/fixtures/pi-cumulative-rpc.mjs",
    );
    const viteNodePath = join(
      process.cwd(),
      "node_modules/vite-node/vite-node.mjs",
    );
    const { spawnSync } =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );

    try {
      const startedAt = Date.now();
      const child = spawnSync(
        process.execPath,
        ["--max-old-space-size=256", viteNodePath, "--script", runnerPath],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PI_FIXTURE_EVENTS: "4400",
            PI_FIXTURE_PAYLOAD_BYTES: "384",
            PI_FIXTURE_LOG_PATH: logPath,
            PI_FIXTURE_RPC_PATH: rpcPath,
          },
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 45_000,
        },
      );
      const durationMs = Date.now() - startedAt;
      const summaryLine = child.stdout.trim().split("\n").at(-1);
      const summary = summaryLine
        ? (JSON.parse(summaryLine) as {
            eventCount: number;
            outputBytes: number;
            durationMs: number;
          })
        : undefined;
      console.info(
        `Pi 4,400-event heap reproduction: status=${child.status} signal=${child.signal} durationMs=${durationMs} outputBytes=${summary?.outputBytes ?? "unavailable"}`,
      );

      expect(child.signal, child.stderr).toBeNull();
      expect(child.status, child.stderr).toBe(0);
      expect(summary).toMatchObject({ eventCount: 4400 });
      expect(summary?.outputBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
