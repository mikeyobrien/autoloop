import { type ChildProcess, spawn } from "node:child_process";
import { delimiter } from "node:path";
import {
  initAcpSession,
  sendAcpPrompt,
  terminateAcpSession,
} from "@mobrienv/autoloop-backends/acp-client";
import {
  killProcessTree,
  processGroupSpawnOptions,
} from "@mobrienv/autoloop-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSpawnTarget } from "../src/spawn-target.js";

// win32: killProcessTree runs `taskkill /T /F`; never aim it at the fake pid.
vi.mock("@mobrienv/autoloop-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-core")>();
  return {
    ...actual,
    killProcessTree: vi.fn((pid: number, signal?: NodeJS.Signals) =>
      process.platform === "win32" ? true : actual.killProcessTree(pid, signal),
    ),
  };
});

// Keep the spawn assertions independent of provider shims installed on the
// host PATH (e.g. a real `kiro-cli.cmd` on win32).
vi.mock("../src/spawn-target.js", () => ({
  resolveSpawnTarget: vi.fn((command: string, args: string[]) => ({
    command,
    args,
  })),
}));

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
    // A live ChildProcess starts with both null.
    (child as any).exitCode = null;
    (child as any).signalCode = null;
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
  it("spawns child with the process-group options for tree cleanup", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const session = await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });

    // POSIX: { detached: true }; win32: { detached: false, windowsHide: true }.
    expect(spawnFn).toHaveBeenCalledWith(
      "kiro-cli",
      ["--acp"],
      expect.objectContaining(processGroupSpawnOptions()),
    );
    expect(spawnFn.mock.calls.at(-1)?.[2]).not.toHaveProperty(
      "windowsVerbatimArguments",
    );
    expect(session.sessionId).toBe("test-session");
  });

  it("ignores a stdin pipe error so teardown does not crash", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });
    const child = spawnFn.mock.results.at(-1)?.value as ChildProcess;
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(() => child.stdin?.emit("error", epipe)).not.toThrow();
  });

  it("spawns a win32 cmd shim through the resolved cmd.exe target", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    vi.mocked(resolveSpawnTarget).mockReturnValueOnce({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\npm\\npx.cmd ^"-y^""'],
      windowsVerbatimArguments: true,
    });
    await initAcpSession({
      command: "npx",
      args: ["-y"],
      cwd: "/tmp",
      trustAllTools: true,
      env: { PATH: "C:\\npm" },
    });

    expect(resolveSpawnTarget).toHaveBeenLastCalledWith("npx", ["-y"], {
      env: { PATH: "C:\\npm" },
      cwd: "/tmp",
    });
    expect(spawnFn).toHaveBeenLastCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", '"C:\\npm\\npx.cmd ^"-y^""'],
      expect.objectContaining({ windowsVerbatimArguments: true }),
    );
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

  it("sanitizes the environment passed to the ACP process", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp/project",
      trustAllTools: true,
      environmentPolicy: "hardened",
      env: {
        PATH: ["/usr/bin", "/tmp/project/bin"].join(delimiter),
        NORMAL_PROJECT_FLAG: "enabled",
        NODE_OPTIONS: "--require ./owned.js",
      },
    });

    const options = spawnFn.mock.calls.at(-1)?.[2];
    expect(options.env.NORMAL_PROJECT_FLAG).toBe("enabled");
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.env.PATH).toBe("/usr/bin");
  });

  it("inherits the ACP process environment when policy is omitted", async () => {
    const spawnFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const env = {
      PATH: "/usr/bin:/tmp/project/bin",
      NODE_OPTIONS: "--require ./project-hook.js",
    };
    await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp/project",
      trustAllTools: true,
      env,
    });

    expect(spawnFn.mock.calls.at(-1)?.[2].env).toBe(env);
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

    expect(killProcessTree).toHaveBeenCalledWith(12345, "SIGTERM");
    if (process.platform !== "win32") {
      // process.kill(-pid) targets the process group — requires detached: true
      expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");
    }
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

  it.each([
    ["win32", "exitCode", 0],
    ["win32", "signalCode", "SIGINT"],
    ["linux", "exitCode", 0],
    ["linux", "signalCode", "SIGINT"],
  ])("handles a child that already exited on %s (%s set)", async (platform, field, value) => {
    const session = await initAcpSession({
      command: "kiro-cli",
      args: ["--acp"],
      cwd: "/tmp",
      trustAllTools: true,
    });
    // win32: an operator interrupt's taskkill ends the child outside Node,
    // so `killed` stays false; the pid may already be reused -> no kill.
    // POSIX: the pgid stays reserved while group members live -> group kill.
    (session.process as any)[field] = value;
    vi.mocked(killProcessTree).mockClear();
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: platform });
    try {
      await terminateAcpSession(session);
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }

    if (platform === "win32") {
      expect(killProcessTree).not.toHaveBeenCalled();
    } else {
      expect(killProcessTree).toHaveBeenCalledWith(12345, "SIGKILL");
      expect(killProcessTree).toHaveBeenCalledTimes(1);
    }
    expect(session.process.kill).not.toHaveBeenCalled();
  });
});
