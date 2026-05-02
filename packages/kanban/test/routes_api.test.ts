import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, type KanbanContext } from "../src/app.js";
import { TaskStore } from "../src/task_store.js";

const baseCtx: KanbanContext = {
  projectDir: "/tmp/project",
  stateDir: "/tmp/state",
  bundleRoot: "/tmp/bundle",
  selfCmd: "autoloop",
  autoloopBin: "autoloop",
  listPresets: () => [],
};

function freshStore(): TaskStore {
  const dir = mkdtempSync(join(tmpdir(), "kanban-api-test-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
    scopeResolver: () => dir,
  });
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonPatch(body: unknown): RequestInit {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("apiRoutes", () => {
  it("GET /api/tasks returns empty array on fresh store", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/tasks creates a task", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request(
      "/api/tasks",
      jsonPost({ title: "task 1", priority: 2 }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      priority: number;
    };
    expect(body.title).toBe("task 1");
    expect(body.priority).toBe(2);
    expect(typeof body.id).toBe("string");
  });

  it("POST /api/tasks persists preset", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request(
      "/api/tasks",
      jsonPost({ title: "t", preset: "autocode" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preset?: string };
    expect(body.preset).toBe("autocode");
  });

  it("POST /api/tasks returns 400 when title missing", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks", jsonPost({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "title required" });
  });

  it("PATCH /api/tasks/:id updates column", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonPatch({ column: "in_progress" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { column?: string };
    expect(body.column).toBe("in_progress");
  });

  it("PATCH /api/tasks/:id updates preset", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonPatch({ preset: "new" }),
    );
    expect(res.status).toBe(200);
    expect(store.get(t.id)?.preset).toBe("new");
  });

  it("PATCH /api/tasks/:id returns 404 on missing task", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request(
      "/api/tasks/nonexistent",
      jsonPatch({ column: "in_progress" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("PATCH /api/tasks/:id accepts worktree_opt_in on fresh task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonPatch({ worktree_opt_in: true }),
    );
    expect(res.status).toBe(200);
    expect(store.get(t.id)?.worktree_opt_in).toBe(true);
  });

  it("PATCH /api/tasks/:id rejects worktree_opt_in once autoloop is running", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    store.setAutoloop(t.id, {
      state: "running",
      run_id: "r1",
      workspace: "/tmp/x",
    });
    const app = createApp(baseCtx, store);
    const res = await app.request(
      `/api/tasks/${t.id}`,
      jsonPatch({ worktree_opt_in: true }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cannot toggle worktree after agent has started",
    });
  });

  it("GET /api/tasks/archived returns [] on fresh store", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/archived");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/tasks/:id/archive succeeds on closed task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    store.close(t.id);
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/archive`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(t.id);
  });

  it("POST /api/tasks/:id/archive returns 409 when task is still open", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/archive`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("POST /api/tasks/:id/unarchive restores an archived task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    store.close(t.id);
    store.archiveOne(t.id);
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/unarchive`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBe(t.id);
    expect(body.status).toBe("open");
  });

  it("POST /api/tasks/:id/unarchive returns 404 on unknown id", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/nope/unarchive", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/tasks/archive sweeps closed tasks", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request(
      "/api/tasks/archive",
      jsonPost({ scope: "all" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; ids: string[] };
    expect(body).toEqual({ count: 0, ids: [] });
  });

  it("POST /api/tasks/:id/restart returns ok on existing task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/restart`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: t.id });
  });

  it("POST /api/tasks/:id/restart returns 404 on unknown id", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/nope/restart", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/tasks/:id/kill returns ok on existing task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/kill`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: t.id });
  });

  it("POST /api/tasks/:id/kill returns 404 on unknown id", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/nope/kill", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /api/tasks/:id/start promotes lane then 500s with stub runtime", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/start`, {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "KanbanRuntime not installed — WS layer lands in slice 9",
    );
    // Lane promotion happens BEFORE ensurePtyForTask, so the column must
    // reflect in_progress even though the spawn threw.
    expect(store.get(t.id)?.column).toBe("in_progress");
  });

  it("POST /api/tasks/:id/start returns 404 on unknown id", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/nope/start", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/:id/preview returns empty events on existing task", async () => {
    const store = freshStore();
    const t = store.add({ title: "t", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/api/tasks/${t.id}/preview`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [] });
  });

  it("GET /api/tasks/:id/preview returns 404 on unknown id", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/tasks/nope/preview");
    expect(res.status).toBe(404);
  });
});
