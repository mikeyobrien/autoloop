import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanContext } from "../src/app.js";
import { installKanban } from "../src/install.js";
import type { KanbanRuntime } from "../src/runtime.js";
import { createStubRuntime } from "../src/runtime.js";
import { TaskStore } from "../src/task_store.js";

const baseCtx: KanbanContext = {
  projectDir: "/tmp/project",
  stateDir: "/tmp/state",
  bundleRoot: "/tmp/bundle",
  selfCmd: "autoloop",
  autoloopBin: "autoloop",
  listPresets: () => [],
};

function freshStore(dir: string): TaskStore {
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
  });
}

function silentServer(): HttpServer {
  const s = createServer();
  return s;
}

describe("installKanban lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "autoloop-kanban-install-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("startup reset flips running/idle to detached but leaves paused alone", () => {
    const store = freshStore(tmpDir);
    const running = store.add({ title: "running" });
    store.setAutoloop(running.id, {
      state: "running",
      run_id: "r-run",
      workspace: tmpDir,
    });
    const idle = store.add({ title: "idle" });
    store.setAutoloop(idle.id, {
      state: "idle",
      run_id: "r-idle",
      workspace: tmpDir,
    });
    const paused = store.add({ title: "paused" });
    store.setAutoloop(paused.id, {
      state: "paused",
      run_id: "r-paused",
      workspace: tmpDir,
    });

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime: createStubRuntime(),
      stallTickMs: 0,
    });
    try {
      expect(store.get(running.id)?.autoloop?.state).toBe("detached");
      expect(store.get(idle.id)?.autoloop?.state).toBe("detached");
      expect(store.get(paused.id)?.autoloop?.state).toBe("paused");
    } finally {
      handle.close();
      server.close();
    }
  });

  it("initial hidden-column sweep removes autoloop-owned workspace dirs", () => {
    const autoloopHomeDir = join(tmpDir, "home");
    mkdirSync(autoloopHomeDir, { recursive: true });
    vi.stubEnv("AUTOLOOP_HOME", autoloopHomeDir);

    const store = freshStore(tmpDir);
    const ws = join(autoloopHomeDir, "ws-hidden", "work");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "marker"), "x");
    const t = store.add({ title: "done-task", scope: autoloopHomeDir });
    store.setAutoloop(t.id, {
      state: "detached",
      run_id: "r",
      workspace: ws,
    });
    store.setColumn(t.id, "done");
    expect(existsSync(ws)).toBe(true);

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime: createStubRuntime(),
      stallTickMs: 0,
    });
    try {
      expect(existsSync(ws)).toBe(false);
    } finally {
      handle.close();
      server.close();
    }
  });

  it("close() tears down the runtime via runtime.shutdown()", () => {
    const store = freshStore(tmpDir);
    let shutdownCalls = 0;
    const runtime: KanbanRuntime = {
      ...createStubRuntime(),
      shutdown: () => {
        shutdownCalls++;
      },
    };

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime,
      stallTickMs: 0,
    });
    expect(shutdownCalls).toBe(0);
    handle.close();
    expect(shutdownCalls).toBe(1);
    server.close();
  });

  it("stall sweeper kills an idle PTY and stamps autoloop.state = crashed", async () => {
    const cfgPath = join(tmpDir, "kanban.toml");
    writeFileSync(cfgPath, "stall_timeout_ms = 5000\n");
    vi.stubEnv("AUTOLOOP_KANBAN_CONFIG", cfgPath);

    const store = freshStore(tmpDir);
    const t = store.add({ title: "idle-pty" });
    store.setAutoloop(t.id, {
      state: "running",
      run_id: "r-idle",
      workspace: tmpDir,
    });

    let killed: string | null = null;
    const runtime: KanbanRuntime = {
      ...createStubRuntime(),
      killAgent: (id) => {
        killed = id;
        return true;
      },
      statsLivePtys: () => [{ taskId: t.id, lastDataMs: Date.now() - 10_000 }],
    };

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime,
      stallTickMs: 20,
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      expect(killed).toBe(t.id);
      expect(store.get(t.id)?.autoloop?.state).toBe("crashed");
    } finally {
      handle.close();
      server.close();
    }
  });

  it("close() clears the stall interval (no ticks after close)", async () => {
    const cfgPath = join(tmpDir, "kanban.toml");
    writeFileSync(cfgPath, "stall_timeout_ms = 1\n");
    vi.stubEnv("AUTOLOOP_KANBAN_CONFIG", cfgPath);

    const store = freshStore(tmpDir);

    let statsCalls = 0;
    const runtime: KanbanRuntime = {
      ...createStubRuntime(),
      statsLivePtys: () => {
        statsCalls++;
        return [];
      },
    };

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime,
      stallTickMs: 20,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(statsCalls).toBeGreaterThan(0);
    handle.close();
    const countAtClose = statsCalls;
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(statsCalls).toBe(countAtClose);
    server.close();
  });

  it("stall sweeper is a no-op when stall_timeout_ms <= 0", async () => {
    const cfgPath = join(tmpDir, "kanban.toml");
    writeFileSync(cfgPath, "stall_timeout_ms = 0\n");
    vi.stubEnv("AUTOLOOP_KANBAN_CONFIG", cfgPath);

    const store = freshStore(tmpDir);
    const t = store.add({ title: "would-stall" });

    let killed = false;
    const runtime: KanbanRuntime = {
      ...createStubRuntime(),
      killAgent: () => {
        killed = true;
        return true;
      },
      statsLivePtys: () => [{ taskId: t.id, lastDataMs: Date.now() - 10_000 }],
    };

    const server = silentServer();
    const handle = installKanban(server, baseCtx, store, {
      runtime,
      stallTickMs: 20,
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      expect(killed).toBe(false);
    } finally {
      handle.close();
      server.close();
    }
  });
});
