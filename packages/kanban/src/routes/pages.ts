import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { KanbanContext } from "../app.js";
import { autoloopHome } from "../paths.js";
import type { KanbanRuntime } from "../runtime.js";
import type { TaskStore } from "../task_store.js";
import { renderArchivePage } from "../views/archive.js";
import { renderPage } from "../views/board.js";
import { renderFullscreenTerm } from "../views/term.js";

export function pageRoutes(
  app: Hono,
  _ctx: KanbanContext,
  store: TaskStore,
  _runtime: KanbanRuntime,
): void {
  app.get("/kanban", (c) => {
    const scope = store.currentScope();
    const tasks = store.list({ includeDone: true });
    const showHidden = c.req.query("hidden") !== "0";
    return c.html(renderPage(tasks, scope, showHidden));
  });

  app.get("/archive", (c) => {
    const scope = c.req.query("scope") === "all" ? "all" : store.currentScope();
    const archived = store.listArchived({
      scope: scope === "all" ? "all" : undefined,
    });
    return c.html(renderArchivePage(archived, scope));
  });

  app.get("/kanban/term/:id", (c) => {
    const id = c.req.param("id");
    const task = store.get(id);
    if (!task) return c.text("not found", 404);
    return c.html(renderFullscreenTerm(task));
  });

  // TODO(autoloop-journal): port sessionsWatcher once readPreview has a real
  //   implementation (see views/card.ts). For now SSE only emits `reload`
  //   events driven by the tasks.jsonl watcher.
  app.get("/kanban/events", (c) =>
    streamSSE(c, async (stream) => {
      const notifyReload = () =>
        stream.writeSSE({ event: "reload", data: "" }).catch(() => {});
      let tasksWatcher: ReturnType<typeof watch> | null = null;
      try {
        const tasksRoot = join(autoloopHome(), "tasks");
        if (existsSync(tasksRoot)) {
          tasksWatcher = watch(
            tasksRoot,
            { persistent: false, recursive: true },
            (_, fname) => {
              if (!fname) return;
              const base = fname.split(/[\\/]/).pop() || fname;
              if (base === "tasks.jsonl") notifyReload();
            },
          );
        } else {
          tasksWatcher = watch(
            autoloopHome(),
            { persistent: false },
            (_, fname) => {
              if (fname === "tasks.jsonl") notifyReload();
            },
          );
        }
      } catch {
        /* autoloopHome may not exist yet, or recursive watch unsupported */
      }
      stream.onAbort(() => {
        try {
          tasksWatcher?.close();
        } catch {
          /* already closed */
        }
      });
      await stream.writeSSE({ event: "init", data: "" });
      await new Promise<void>(() => {});
    }),
  );
}
