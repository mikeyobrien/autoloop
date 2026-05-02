# @mobrienv/autoloop-kanban

Hono-based kanban dashboard that spawns `autoloop run` inside per-task tmux
sessions and bridges each PTY to the browser over WebSocket.

## CLI

```
autoloop kanban [--port N] [--host H] [--project-dir DIR]
```

| Flag            | Default     | Notes                                    |
| --------------- | ----------- | ---------------------------------------- |
| `--port`, `-p`  | `4801`      | Listen port.                             |
| `--host`        | `127.0.0.1` | Bind host. Loopback by default.          |
| `--project-dir` | `.`         | Project root (used for scope detection). |
| `--help`, `-h`  | —           | Print usage.                             |

## Endpoints

| Method | Path                                 | Purpose                              |
| ------ | ------------------------------------ | ------------------------------------ |
| GET    | `/healthz`                           | Liveness probe — `{status:"ok"}`.    |
| GET    | `/kanban`                            | Board page (HTML).                   |
| GET    | `/archive`                           | Archive page (HTML).                 |
| GET    | `/kanban/term/:id`                   | Fullscreen terminal for a task.      |
| GET    | `/kanban/events`                     | SSE stream of `tasks.jsonl` updates. |
| …      | `/api/tasks*`                        | REST API (see `src/routes/api.ts`).  |
| WS     | `/ws/kanban-pty?taskId=&cols=&rows=` | Browser ↔ PTY bridge.                |

## Environment variables

| Name                     | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `AUTOLOOP_HOME`          | Override autoloop state root (default `~/.autoloop`).                      |
| `AUTOLOOP_KANBAN_CONFIG` | Path to `kanban.toml` override (default `~/.config/autoloop/kanban.toml`). |

## Programmatic API

```ts
import { createServer } from "node:http";
import { installKanban, TaskStore } from "@mobrienv/autoloop-kanban";

const server = createServer();
const store = new TaskStore({ /* path, archivePath */ });
const { app, close } = installKanban(server, ctx, store);
server.on("request", (req, res) => {/* bridge to app.fetch */});
server.listen(4801);
// ... later:
close();
server.close();
```

See `src/install.ts` for the full `InstallKanbanResult` shape and the stall
sweeper + startup-reset lifecycle details.
