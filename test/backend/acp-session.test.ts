import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initAcpSession,
  terminateAcpSession,
} from "../../src/backend/acp-client.js";
import { signalInterrupt } from "../../src/backend/kiro-bridge.js";

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
    cancel: vi.fn(),
  })),
}));

describe("initAcpSession", () => {
  it("spawns child with detached: true for process group cleanup", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    await initAcpSession({
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
