import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { KanbanContext } from "../src/app.js";
import type { IPtyLike, PtyExitInfo } from "../src/pty_session.js";
import type { SpawnAutoloopFn } from "../src/runtime_live.js";
import { createKanbanRuntime } from "../src/runtime_live.js";
import { TaskStore } from "../src/task_store.js";

class FakePty implements IPtyLike {
  private dataCb: (d: string) => void = () => {};
  private exitCb: (e?: PtyExitInfo) => void = () => {};
  public killed = false;
  onData(cb: (d: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (e?: PtyExitInfo) => void): void {
    this.exitCb = cb;
  }
  write(_data: string): void {
    /* noop for these tests */
  }
  resize(_cols: number, _rows: number): void {
    /* noop */
  }
  kill(): void {
    this.killed = true;
    this.exitCb({ exitCode: 0 });
  }
  emitExit(e?: PtyExitInfo): void {
    this.exitCb(e);
  }
  emitData(d: string): void {
    this.dataCb(d);
  }
}

function freshStore(): TaskStore {
  const dir = mkdtempSync(join(tmpdir(), "kanban-runtime-live-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
  });
}

const baseCtx: KanbanContext = {
  projectDir: "/tmp/project",
  stateDir: "/tmp/state",
  bundleRoot: "/tmp/bundle",
  selfCmd: "autoloop",
  autoloopBin: "autoloop",
  listPresets: () => [],
};

function makeSpawnFn(): {
  spawn: SpawnAutoloopFn;
  ptys: FakePty[];
} {
  const ptys: FakePty[] = [];
  const spawn: SpawnAutoloopFn = (task, _cols, _rows, store) => {
    const pty = new FakePty();
    ptys.push(pty);
    const runId = `kanban-${task.id}`;
    store.setAutoloop(task.id, {
      state: "running",
      run_id: runId,
      workspace: "/tmp/fake",
    });
    return {
      pty,
      pid: 1234,
      runId,
      cwd: "/tmp/fake",
      tmuxSession: `kanban-${task.id}`,
    };
  };
  return { spawn, ptys };
}

describe("createKanbanRuntime", () => {
  it("returns all five runtime methods", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    expect(typeof runtime.ensurePtyForTask).toBe("function");
    expect(typeof runtime.killAgent).toBe("function");
    expect(typeof runtime.tryAutoDispatch).toBe("function");
    expect(typeof runtime.reclaimWorktreeForTask).toBe("function");
    expect(typeof runtime.hasLivePty).toBe("function");
  });

  it("hasLivePty is false for unknown ids", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    expect(runtime.hasLivePty("unknown")).toBe(false);
  });

  it("killAgent returns true even for unknown ids", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    expect(runtime.killAgent("nope")).toBe(true);
  });

  it("ensurePtyForTask spawns once and is idempotent", () => {
    const store = freshStore();
    const { spawn, ptys } = makeSpawnFn();
    const spy = vi.fn(spawn);
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spy });
    const t = store.add({ title: "go" });
    const session1 = runtime.ensurePtyForTask(t.id, 80, 24);
    expect(runtime.hasLivePty(t.id)).toBe(true);
    const session2 = runtime.ensurePtyForTask(t.id, 80, 24);
    expect(session2).toBe(session1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ptys.length).toBe(1);
  });

  it("killAgent clears the live PTY and stamps detached state", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    const t = store.add({ title: "kill" });
    runtime.ensurePtyForTask(t.id, 80, 24);
    expect(runtime.hasLivePty(t.id)).toBe(true);
    runtime.killAgent(t.id);
    expect(runtime.hasLivePty(t.id)).toBe(false);
    expect(store.get(t.id)?.autoloop?.state).toBe("detached");
  });

  it("exit callback classifies non-zero exit as crashed", () => {
    const store = freshStore();
    const { spawn, ptys } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    const t = store.add({ title: "crash" });
    runtime.ensurePtyForTask(t.id, 80, 24);
    ptys[0].emitExit({ exitCode: 2 });
    const after = store.get(t.id);
    expect(after?.autoloop?.state).toBe("crashed");
    expect(after?.autoloop?.exit_code).toBe(2);
    expect(runtime.hasLivePty(t.id)).toBe(false);
  });

  it("exit callback classifies exit 0 as detached", () => {
    const store = freshStore();
    const { spawn, ptys } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    const t = store.add({ title: "clean-exit" });
    runtime.ensurePtyForTask(t.id, 80, 24);
    ptys[0].emitExit({ exitCode: 0 });
    const after = store.get(t.id);
    expect(after?.autoloop?.state).toBe("detached");
    expect(after?.autoloop?.exit_code).toBe(0);
  });

  it("exit callback classifies signal > 0 as crashed", () => {
    const store = freshStore();
    const { spawn, ptys } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    const t = store.add({ title: "signal" });
    runtime.ensurePtyForTask(t.id, 80, 24);
    ptys[0].emitExit({ signal: 9 });
    const after = store.get(t.id);
    expect(after?.autoloop?.state).toBe("crashed");
  });

  it("tryAutoDispatch on an empty queue does nothing", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const spy = vi.fn(spawn);
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spy });
    runtime.tryAutoDispatch();
    expect(spy).not.toHaveBeenCalled();
  });

  it("tryAutoDispatch spawns the next queued in_progress task", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const spy = vi.fn(spawn);
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spy });
    const t = store.add({ title: "queued" });
    store.setColumn(t.id, "in_progress");
    runtime.tryAutoDispatch();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(runtime.hasLivePty(t.id)).toBe(true);
  });

  it("reclaimWorktreeForTask on a task with no worktree returns zeros", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    const t = store.add({ title: "no-wt" });
    const r = runtime.reclaimWorktreeForTask(t);
    expect(r).toEqual({ removed: 0, preserved: 0, errors: 0 });
  });

  it("ensurePtyForTask throws for unknown task id", () => {
    const store = freshStore();
    const { spawn } = makeSpawnFn();
    const runtime = createKanbanRuntime(baseCtx, store, { spawnFn: spawn });
    expect(() => runtime.ensurePtyForTask("ghost", 80, 24)).toThrow(
      /task not found/,
    );
  });
});
