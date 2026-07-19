import { type ChildProcess, spawn } from "node:child_process";
import {
  initAcpSession,
  sendAcpPrompt,
  terminateAcpSession,
} from "@mobrienv/autoloop-backends/acp-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
  const EventEmitter = require("node:events");
  const { Readable, Writable } = require("node:stream");

  function createMockChild(detached: boolean | undefined): ChildProcess {
    const child = new EventEmitter() as ChildProcess;
    child.stdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.pid = 12345;
    child.killed = false;
    child.kill = vi.fn(() => {
      child.killed = true;
      process.nextTick(() => {
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
      });
      return true;
    });
    (child as any)._detached = detached;
    return child;
  }

  return {
    spawn: vi.fn((_cmd: string, _args: string[], opts: any) => {
      return createMockChild(opts?.detached);
    }),
  };
});

vi.mock("@agentclientprotocol/sdk", () => ({
  PROTOCOL_VERSION: "1.0",
  ndJsonStream: () => ({
    writable: new WritableStream(),
  }),
  ClientSideConnection: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue({}),
    newSession: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
    setSessionMode: vi.fn().mockResolvedValue({}),
    unstable_setSessionModel: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockImplementation(() => new Promise(() => {})),
    cancel: vi.fn(),
  })),
}));

describe("initAcpSession", () => {
  it("spawns child with detached: true for process group cleanup", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const session = await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    expect(spawnFn).toHaveBeenCalledWith(
      "kiro-cli",
      ["--acp"],
      expect.objectContaining({ detached: true }),
    );
    expect(session.sessionId).toBe("test-session");
  });

  it("times out a wedged handshake and reaps the child", async () => {
    const sdk = await import("@agentclientprotocol/sdk");
    const Connection = sdk.ClientSideConnection as unknown as ReturnType<
      typeof vi.fn
    >;
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    Connection.mockImplementationOnce(() => ({
      initialize: vi.fn().mockImplementation(() => new Promise(() => {})),
      cancel: vi.fn(),
    }));

    try {
      const pending = initAcpSession({
        command: "wedged-acp",
        args: [],
        cwd: "/tmp",
        trustAllTools: true,
        handshakeTimeoutMs: 30,
      });

      await expect(pending).rejects.toThrow(
        'ACP handshake with "wedged-acp" timed out after 30ms',
      );
      const child = spawnFn.mock.results.at(-1)?.value as ChildProcess;
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.killed).toBe(true);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("rejects immediately when the child exits during the handshake", async () => {
    const sdk = await import("@agentclientprotocol/sdk");
    const Connection = sdk.ClientSideConnection as unknown as ReturnType<
      typeof vi.fn
    >;
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    Connection.mockImplementationOnce(() => ({
      initialize: vi.fn().mockImplementation(() => new Promise(() => {})),
      cancel: vi.fn(),
    }));

    try {
      const pending = initAcpSession({
        command: "crashing-acp",
        args: [],
        cwd: "/tmp",
        trustAllTools: true,
        handshakeTimeoutMs: 10_000,
      });
      const child = spawnFn.mock.results.at(-1)?.value as ChildProcess;
      child.stderr?.push("boom: command exploded\n");
      await new Promise((resolve) => setImmediate(resolve));
      child.emit("close", 1, null);

      const error = await pending.catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        'ACP agent ("crashing-acp") exited during the ACP handshake: code=1 signal=null',
      );
      expect((error as Error).message).toContain("boom: command exploded");
      expect((error as Error).message).not.toContain("timed out");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("resolves provider metadata from options and command", async () => {
    const session = await initAcpSession({
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    expect(session.provider.id).toBe("claude-agent-acp");
    expect(session.provider.crashLabel).toBe("claude-agent-acp");
  });

  it("passes agent and model to capable ACP providers", async () => {
    const sdk = await import("@agentclientprotocol/sdk");
    const Connection = sdk.ClientSideConnection as unknown as ReturnType<
      typeof vi.fn
    >;

    await initAcpSession({
      provider: "kiro",
      command: "kiro-cli",
      args: ["acp"],
      cwd: "/tmp",
      trustAllTools: true,
      agentName: "reviewer",
      modelId: "sonnet",
    });

    const connection = Connection.mock.results.at(-1)?.value;
    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "test-session",
      modeId: "reviewer",
    });
    expect(connection.unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: "test-session",
      modelId: "sonnet",
    });
  });

  it("uses provider crash labels in prompt errors", async () => {
    const session = await initAcpSession({
      provider: "claude-agent-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    process.nextTick(() => session.process.emit("close", 9, null));
    const result = await sendAcpPrompt(session, "hello", 1000);

    expect(result.error).toContain("claude-agent-acp exited unexpectedly");
  });
});

describe("terminateAcpSession", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("sends SIGTERM to the child process group via negative PID", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const session = await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    await terminateAcpSession(session);

    // process.kill(-pid) targets the process group — requires detached: true
    expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");
  });

  it("falls back to child.kill if process group kill fails", async () => {
    killSpy.mockImplementation((pid: number, signal?: string) => {
      if (pid < 0) throw new Error("ESRCH");
      return true;
    });

    const session = await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    await terminateAcpSession(session);

    expect(session.process.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
