import { mkdtempSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import type { KanbanContext } from "../src/app.js";
import { installKanban } from "../src/install.js";
import { createStubRuntime } from "../src/runtime.js";
import { TaskStore } from "../src/task_store.js";

const ctx: KanbanContext = {
  projectDir: "/tmp",
  stateDir: "/tmp",
  bundleRoot: "/tmp",
  selfCmd: "autoloop",
  autoloopBin: "autoloop",
  listPresets: () => [],
};

describe("kanban smoke", () => {
  it("boots on ephemeral port and answers GET /healthz with 200", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanban-smoke-"));
    const store = new TaskStore({
      path: join(dir, "tasks.jsonl"),
      archivePath: join(dir, "archive.jsonl"),
    });
    let fetchFn: ((req: Request) => Response | Promise<Response>) | null = null;
    const server = createAdaptorServer({
      fetch: (r) => fetchFn!(r),
    }) as HttpServer;
    const handle = installKanban(server, ctx, store, {
      runtime: createStubRuntime(),
      stallTickMs: 0,
    });
    fetchFn = handle.app.fetch.bind(handle.app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    } finally {
      handle.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
