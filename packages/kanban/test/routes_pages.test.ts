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
  const dir = mkdtempSync(join(tmpdir(), "kanban-pages-test-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
    scopeResolver: () => dir,
  });
}

describe("pageRoutes", () => {
  it("GET /kanban returns 200 HTML with seeded task title", async () => {
    const store = freshStore();
    store.add({ title: "hello", description: "world", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request("/kanban");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/html/);
    const body = await res.text();
    expect(body).toContain("<title>Autoloop Kanban</title>");
    expect(body).toContain("hello");
  });

  it("GET / redirects to /kanban (307)", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/kanban");
  });

  it("GET /kanban includes a viewport meta tag for mobile rendering", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/kanban");
    const body = await res.text();
    expect(body).toContain('<meta name="viewport"');
    expect(body).toContain("width=device-width");
  });

  it("GET /archive includes a viewport meta tag", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/archive");
    const body = await res.text();
    expect(body).toContain('<meta name="viewport"');
  });

  it("GET /kanban?hidden=0 returns 200", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/kanban?hidden=0");
    expect(res.status).toBe(200);
  });

  it("GET /archive returns 200 HTML with autoloop archive title", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/archive");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>Autoloop — Archive</title>");
  });

  it("GET /archive?scope=all returns 200", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/archive?scope=all");
    expect(res.status).toBe(200);
  });

  it("GET /kanban/term/nonexistent returns 404 plain text", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/kanban/term/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("GET /kanban/term/:id renders the task fullscreen view", async () => {
    const store = freshStore();
    const t = store.add({ title: "hello", priority: 3 });
    const app = createApp(baseCtx, store);
    const res = await app.request(`/kanban/term/${t.id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>hello — autoloop</title>");
  });

  it("GET /kanban/events mounts an SSE stream", async () => {
    const app = createApp(baseCtx, freshStore());
    const controller = new AbortController();
    const res = await app.request("/kanban/events", {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
    // Abort so the stream's onAbort handler tears down the watcher and the
    // ReadableStream isn't left open across tests.
    controller.abort();
    try {
      await res.body?.cancel();
    } catch {
      /* already cancelled */
    }
  });
});
