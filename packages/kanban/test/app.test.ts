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

  it("rejects /api/* with mismatched origin when host is 0.0.0.0", async () => {
    const app = createApp(
      { ...baseCtx, host: "0.0.0.0", port: 4801 },
      freshStore(),
    );
    const res = await app.request("/api/foo", {
      headers: { origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "origin mismatch" });
  });

  it("skips origin guard when host is 127.0.0.1 (default)", async () => {
    const app = createApp(baseCtx, freshStore());
    const res = await app.request("/api/foo", {
      headers: { origin: "http://evil.example" },
    });
    // No guard middleware mounted, so /api/foo 404s (origin header ignored).
    expect(res.status).toBe(404);
  });
});
