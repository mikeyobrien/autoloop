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
  const dir = mkdtempSync(join(tmpdir(), "kanban-app-test-"));
  return new TaskStore({
    path: join(dir, "tasks.jsonl"),
    archivePath: join(dir, "archive.jsonl"),
  });
}

describe("createApp", () => {
  it("returns a Hono-shaped object", () => {
    const app = createApp(baseCtx, freshStore());
    expect(typeof app.fetch).toBe("function");
    expect(typeof app.request).toBe("function");
    expect(typeof app.route).toBe("function");
  });

  it("serves 200 {status:ok} at /healthz", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });

  it("rejects /api/* with mismatched Origin", async () => {
    const app = createApp(
      { ...baseCtx, host: "0.0.0.0", port: 4801 },
      freshStore(),
    );
    const res = await app.request("http://192.0.2.10:4801/api/foo", {
      headers: {
        host: "192.0.2.10:4801",
        origin: "http://evil.example",
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "origin mismatch" });
  });

  it("accepts /api/* with matching Origin and Host", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("http://127.0.0.1:4801/api/foo", {
      headers: {
        host: "127.0.0.1:4801",
        origin: "http://127.0.0.1:4801",
      },
    });
    // Guard passes; unknown API path still 404s.
    expect(res.status).toBe(404);
  });

  it("rejects /api/* with same-host scheme mismatch", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("http://127.0.0.1:4801/api/foo", {
      headers: {
        host: "127.0.0.1:4801",
        origin: "https://127.0.0.1:4801",
      },
    });
    expect(res.status).toBe(403);
  });
});
