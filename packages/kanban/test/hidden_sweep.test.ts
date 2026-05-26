import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAutoloopOwnedPath,
  sweepHiddenTaskSessions,
} from "../src/hidden_sweep.js";
import { TaskStore } from "../src/task_store.js";

describe("hidden_sweep", () => {
  let tmpDir: string;
  let autoloopHomeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "autoloop-kanban-sweep-"));
    autoloopHomeDir = join(tmpDir, "home");
    mkdirSync(autoloopHomeDir, { recursive: true });
    vi.stubEnv("AUTOLOOP_HOME", autoloopHomeDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("isAutoloopOwnedPath excludes the home root itself", () => {
    expect(isAutoloopOwnedPath(autoloopHomeDir)).toBe(false);
  });

  it("isAutoloopOwnedPath accepts strict descendants", () => {
    expect(isAutoloopOwnedPath(join(autoloopHomeDir, "sub/deep"))).toBe(true);
  });

  it("isAutoloopOwnedPath rejects unrelated paths", () => {
    expect(isAutoloopOwnedPath("/tmp/unrelated-autoloop-kanban")).toBe(false);
  });

  it("sweep on an empty store returns zero counters", () => {
    const store = new TaskStore({
      path: join(tmpDir, "tasks.jsonl"),
      archivePath: join(tmpDir, "archive.jsonl"),
    });
    expect(sweepHiddenTaskSessions(store)).toEqual({
      sessionsDeleted: 0,
      workspacesDeleted: 0,
      errors: 0,
    });
  });

  it("deletes autoloop-owned workspaces for tasks in hidden columns", () => {
    const store = new TaskStore({
      path: join(tmpDir, "tasks.jsonl"),
      archivePath: join(tmpDir, "archive.jsonl"),
    });
    const ws = join(autoloopHomeDir, "ws-task1", "work");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "marker"), "x");
    const task = store.add({ title: "t1", scope: autoloopHomeDir });
    const patch = store.setAutoloop(task.id, {
      run_id: "r1",
      workspace: ws,
      state: "detached",
    });
    expect(patch.error).toBeUndefined();
    const col = store.setColumn(task.id, "done");
    expect(col.error).toBeUndefined();

    const result = sweepHiddenTaskSessions(store);
    expect(result.workspacesDeleted).toBe(1);
    expect(result.errors).toBe(0);
    expect(existsSync(ws)).toBe(false);
  });

  it("leaves user-owned workspaces (outside autoloop home) untouched", () => {
    const store = new TaskStore({
      path: join(tmpDir, "tasks.jsonl"),
      archivePath: join(tmpDir, "archive.jsonl"),
    });
    const externalWs = join(tmpDir, "external-user-ws");
    mkdirSync(externalWs, { recursive: true });
    writeFileSync(join(externalWs, "keepme"), "y");
    const task = store.add({ title: "t2", scope: autoloopHomeDir });
    store.setAutoloop(task.id, {
      run_id: "r2",
      workspace: externalWs,
      state: "detached",
    });
    store.setColumn(task.id, "done");

    const result = sweepHiddenTaskSessions(store);
    expect(result.workspacesDeleted).toBe(0);
    expect(existsSync(externalWs)).toBe(true);
    expect(existsSync(join(externalWs, "keepme"))).toBe(true);
  });
});
