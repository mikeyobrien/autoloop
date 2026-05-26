import type { Hono } from "hono";
import type { KanbanContext } from "../app.js";
import type { KanbanRuntime } from "../runtime.js";
import type { KanbanColumn, TaskStore } from "../task_store.js";
import { readPreview } from "../views/card.js";

export function apiRoutes(
  app: Hono,
  _ctx: KanbanContext,
  store: TaskStore,
  runtime: KanbanRuntime,
): void {
  app.get("/api/tasks", (c) => c.json(store.list({ includeDone: true })));

  // Archive management. Registered BEFORE :id routes so the static path wins
  // in Hono's matcher.
  app.get("/api/tasks/archived", (c) => {
    const scope = c.req.query("scope") === "all" ? "all" : undefined;
    return c.json(store.listArchived({ scope }));
  });

  app.post("/api/tasks/archive", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scope?: string;
      olderThanDays?: number;
    };
    const scope = body.scope === "all" ? "all" : undefined;
    const r = store.archive({ scope, olderThanDays: body.olderThanDays });
    return c.json({ count: r.count, ids: r.archived.map((t) => t.id) });
  });

  app.post("/api/tasks/:id/unarchive", (c) => {
    const id = c.req.param("id");
    const r = store.unarchive(id);
    if (r.error) return c.json({ error: r.error }, 404);
    return c.json(r.task);
  });

  app.post("/api/tasks/:id/archive", (c) => {
    const id = c.req.param("id");
    const r = store.archiveOne(id);
    if (r.error) {
      const code = r.error.includes("not found") ? 404 : 409;
      return c.json({ error: r.error }, code);
    }
    // runtime.killAgent handles PTY + tmux + setAutoloop(detached) in one call.
    runtime.killAgent(id);
    return c.json(r.task);
  });

  app.post("/api/tasks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      priority?: number;
      worktree_opt_in?: boolean;
      preset?: string;
    };
    if (!body.title) return c.json({ error: "title required" }, 400);
    const t = store.add({
      title: body.title,
      description: body.description,
      priority: body.priority,
      worktree_opt_in: body.worktree_opt_in === true,
      preset: body.preset,
    });
    return c.json(t);
  });

  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      column?: KanbanColumn;
      title?: string;
      description?: string;
      priority?: number;
      worktree_opt_in?: boolean;
      preset?: string;
    };
    const existing = store.get(id);
    if (!existing) return c.json({ error: "not found" }, 404);
    if (
      typeof body.title === "string" ||
      typeof body.description === "string" ||
      typeof body.priority === "number" ||
      typeof body.worktree_opt_in === "boolean" ||
      typeof body.preset === "string"
    ) {
      if (
        typeof body.worktree_opt_in === "boolean" &&
        existing.autoloop?.workspace
      ) {
        return c.json(
          { error: "cannot toggle worktree after agent has started" },
          409,
        );
      }
      store.patch(id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.description === "string"
          ? { description: body.description }
          : {}),
        ...(typeof body.priority === "number"
          ? { priority: body.priority }
          : {}),
        ...(typeof body.worktree_opt_in === "boolean"
          ? { worktree_opt_in: body.worktree_opt_in }
          : {}),
        ...(typeof body.preset === "string" ? { preset: body.preset } : {}),
      });
    }
    if (!body.column) return c.json(store.get(id) ?? { error: "not found" });
    const prevColumn = existing.column ?? "backlog";
    const r = store.setColumn(id, body.column);
    if (body.column === "done" || body.column === "cancelled") {
      // killAgent handles PTY + tmux + setAutoloop(detached) in one call.
      runtime.killAgent(id);
      // Reclaim a worktree if one was materialised. Fetch the latest row
      // (setColumn persisted; existing is stale).
      const postCol = store.get(id);
      if (postCol?.worktree) {
        runtime.reclaimWorktreeForTask(postCol);
      }
    }
    if (body.column === "in_progress" && prevColumn !== "in_progress") {
      runtime.tryAutoDispatch();
    }
    if (prevColumn === "in_progress" && body.column !== "in_progress") {
      runtime.tryAutoDispatch();
    }
    return c.json(r.task ?? { error: r.error });
  });

  app.post("/api/tasks/:id/restart", (c) => {
    const id = c.req.param("id");
    if (!store.get(id)) return c.json({ error: "not found" }, 404);
    runtime.killAgent(id);
    return c.json({ ok: true, id });
  });

  app.post("/api/tasks/:id/kill", (c) => {
    const id = c.req.param("id");
    if (!store.get(id)) return c.json({ error: "not found" }, 404);
    runtime.killAgent(id);
    return c.json({ ok: true, id });
  });

  app.post("/api/tasks/:id/start", (c) => {
    const id = c.req.param("id");
    const task = store.get(id);
    if (!task) return c.json({ error: "not found" }, 404);
    // Promote to in_progress lane BEFORE spawning so the card reflects the
    // user's intent immediately.
    const curCol = task.column ?? "backlog";
    if (curCol !== "in_progress") {
      store.setColumn(id, "in_progress");
    }
    try {
      runtime.ensurePtyForTask(id, 80, 24);
      return c.json({ ok: true, id, alreadyRunning: runtime.hasLivePty(id) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[kanban] play-button spawn failed task=${id} — ${msg}\n`,
      );
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/api/tasks/:id/preview", (c) => {
    const t = store.get(c.req.param("id"));
    if (!t) return c.json({ error: "not found" }, 404);
    // readPreview is stubbed to [] until autoloop journal parser lands; call
    // with empty path so the contract stays stable for slice 10+.
    return c.json({ events: readPreview("") });
  });
}
