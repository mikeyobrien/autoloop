import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { IPtyLike, PtyExitInfo } from "../src/pty_session.js";
import { PtySession } from "../src/pty_session.js";
import type { KanbanRuntime } from "../src/runtime.js";
import { TaskStore } from "../src/task_store.js";
import { installKanbanWs } from "../src/ws.js";

class FakePty implements IPtyLike {
  public writes: string[] = [];
  public resizes: Array<[number, number]> = [];
  public killed = false;
  private exitCb: (e?: PtyExitInfo) => void = () => {};
  onData(_cb: (d: string) => void): void {
    /* no-op — tests drive writes, not reads */
  }
  onExit(cb: (e?: PtyExitInfo) => void): void {
    this.exitCb = cb;
  }
  write(d: string): void {
    this.writes.push(d);
  }
  resize(c: number, r: number): void {
    this.resizes.push([c, r]);
  }
  kill(): void {
    this.killed = true;
    this.exitCb({ exitCode: 0 });
  }
}

function freshStore(): TaskStore {
  const dir = mkdtempSync(join(tmpdir(), "kanban-ws-test-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
  });
}

interface Harness {
  port: number;
  store: TaskStore;
  pty: FakePty;
  session: PtySession;
  ensureCalls: Array<{ id: string; cols: number; rows: number }>;
  close(): Promise<void>;
  wsCloseHandle: { close(): void };
}

async function boot(opts: { throwOnEnsure?: boolean } = {}): Promise<Harness> {
  const store = freshStore();
  const pty = new FakePty();
  const session = new PtySession(pty, () => {});
  const ensureCalls: Array<{ id: string; cols: number; rows: number }> = [];
  const runtime: KanbanRuntime = {
    ensurePtyForTask: (id, cols, rows) => {
      ensureCalls.push({ id, cols, rows });
      if (opts.throwOnEnsure) throw new Error("spawn failed");
      return session;
    },
    killAgent: () => true,
    tryAutoDispatch: () => {},
    reclaimWorktreeForTask: () => ({ removed: 0, preserved: 0, errors: 0 }),
    hasLivePty: () => true,
    shutdown: () => {},
    statsLivePtys: () => [],
  };
  const server = createServer();
  const openSockets = new Set<import("node:net").Socket>();
  server.on("connection", (s) => {
    openSockets.add(s);
    s.on("close", () => openSockets.delete(s));
  });
  const wsCloseHandle = installKanbanWs(server, store, runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string")
    throw new Error("unexpected server address");
  return {
    port: addr.port,
    store,
    pty,
    session,
    ensureCalls,
    wsCloseHandle,
    close: () =>
      new Promise<void>((resolve) => {
        wsCloseHandle.close();
        // Force-drop any lingering sockets so close() resolves promptly
        // even when tests deliberately left a dangling client.
        for (const s of openSockets) s.destroy();
        openSockets.clear();
        server.close(() => resolve());
      }),
  };
}

describe("installKanbanWs", () => {
  let harness: Harness | undefined;

  beforeEach(() => {
    harness = undefined;
  });

  afterEach(async () => {
    if (harness) await harness.close();
  }, 20_000);

  it("does not invoke the runtime on unknown pathname", async () => {
    harness = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${harness.port}/ws/unknown`);
    ws.on("error", () => {
      /* silence "closed before established" when we terminate below */
    });
    // The upgrade handler intentionally returns without responding — no
    // other listener handles the path, so the client hangs until we drop
    // it. Give the server 200ms to prove it DIDN'T call into the runtime,
    // then tear down.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(harness.ensureCalls).toEqual([]);
    ws.terminate();
  });

  it("destroys the socket when taskId is unknown", async () => {
    harness = await boot();
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/ws/kanban-pty?taskId=nope`,
    );
    await new Promise<void>((resolve) => {
      ws.on("error", () => resolve());
      ws.on("close", () => resolve());
    });
    expect(harness.ensureCalls).toEqual([]);
  });

  it("attaches the PTY on happy path and pipes resize JSON through", async () => {
    harness = await boot();
    const t = harness.store.add({ title: "live" });
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/ws/kanban-pty?taskId=${t.id}&cols=100&rows=30`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    expect(harness.ensureCalls).toEqual([{ id: t.id, cols: 100, rows: 30 }]);
    // initial resize on attach (the handler always calls s.resize(cols, rows))
    expect(harness.pty.resizes).toEqual([[100, 30]]);
    ws.send(JSON.stringify({ type: "resize", cols: 200, rows: 40 }));
    // Wait until the server processes the message.
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (harness?.pty.resizes.length >= 2) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    expect(harness.pty.resizes).toContainEqual([200, 40]);
    ws.close();
    await new Promise<void>((resolve) => ws.on("close", () => resolve()));
  });

  it("treats non-JSON input as stdin", async () => {
    harness = await boot();
    const t = harness.store.add({ title: "stdin" });
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/ws/kanban-pty?taskId=${t.id}`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.send("hello");
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (harness?.pty.writes.length >= 1) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    expect(harness.pty.writes).toEqual(["hello"]);
    ws.close();
    await new Promise<void>((resolve) => ws.on("close", () => resolve()));
  });

  it("closes the WS with code 4001 when ensurePtyForTask throws", async () => {
    harness = await boot({ throwOnEnsure: true });
    const t = harness.store.add({ title: "throw" });
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/ws/kanban-pty?taskId=${t.id}`,
    );
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(4001);
  });

  it("close() detaches the upgrade handler (subsequent WS fails)", async () => {
    harness = await boot();
    const t = harness.store.add({ title: "detach" });
    harness.wsCloseHandle.close();
    const ws = new WebSocket(
      `ws://127.0.0.1:${harness.port}/ws/kanban-pty?taskId=${t.id}`,
    );
    ws.on("error", () => {
      /* silence "closed before established" when we terminate below */
    });
    // Same contract as the unknown-pathname case: with the listener gone
    // the upgrade goes unanswered. Wait briefly to prove the runtime was
    // NOT invoked, then tear the client down.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(harness.ensureCalls).toEqual([]);
    ws.terminate();
  });
});
