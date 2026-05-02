# @mobrienv/autoloop-kanban

Hono-based kanban board that spawns `autoloop run` inside per-task tmux
sessions and bridges the PTY to the browser over WebSocket. Port of the
KermesAgent kanban panel, reframed around autoloop runs instead of
`kermes chat`.

Entry points land in later slices:

- `createApp(ctx)` — returns the Hono app (pages, API, SSE).
- `installKanban(app, server)` — attaches the WebSocket PTY upgrade handler.
- `spawnAutoloopForTask(task, cols, rows, opts)` — spawns `autoloop run <preset> <prompt>` inside a tmux session named `kanban-<id>` on socket `-L autoloop-kanban`.

CLI entry point is `autoloop kanban [--port <n>]`, mirroring
`autoloop dashboard`.
