import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join as j } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { expect, test } from "vitest";
import type { KanbanContext } from "../src/app.js";
import { installKanban } from "../src/install.js";
import { createStubRuntime } from "../src/runtime.js";
import { TaskStore } from "../src/task_store.js";

test("kanban smoke: GET /healthz returns 200 on an ephemeral port", async () => {
  const d = mkdtempSync(j(tmpdir(), "kanban-smoke-"));
  const store = new TaskStore({ path: j(d, "t"), archivePath: j(d, "a") });
  const ctx: KanbanContext = {
    projectDir: d,
    stateDir: d,
    bundleRoot: d,
    selfCmd: "a",
    autoloopBin: "a",
    listPresets: () => [],
  };
  const server = createServer();
  const h = installKanban(server, ctx, store, {
    runtime: createStubRuntime(),
    stallTickMs: 0,
  });
  server.on("request", getRequestListener(h.app.fetch));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  } finally {
    h.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
