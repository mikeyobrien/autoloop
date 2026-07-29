// WebSocket upgrade handler for the kanban terminal panel. One path only:
// `/ws/kanban-pty?taskId=<id>&cols=<n>&rows=<n>`. Untied-chat sessions
// are out of scope for autoloop; no `/ws/kanban-chat-pty` handler here.

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer } from "ws";
import type { KanbanRuntime } from "./runtime.js";
import type { TaskStore } from "./task_store.js";

export interface InstallWsResult {
  /** Detach the upgrade handler + close the WebSocket server. Idempotent.
   *  Does NOT kill any live PTY — runtime-level cleanup lands in slice 10. */
  close(): void;
}

function isOriginAllowed(
  requestOrigin: string | undefined,
  requestHost: string | undefined,
): boolean {
  // Non-browser/native clients often omit Origin. Preserve that behavior while
  // rejecting cross-origin browser upgrades.
  if (!requestOrigin) return true;
  if (!requestHost) return false;

  try {
    const originUrl = new URL(requestOrigin);
    return (
      (originUrl.protocol === "http:" || originUrl.protocol === "https:") &&
      originUrl.host.toLowerCase() === requestHost.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function installKanbanWs(
  server: HttpServer,
  store: TaskStore,
  runtime: KanbanRuntime,
): InstallWsResult {
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = (
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws/kanban-pty") return;

    // Validate browser Origin against the request Host header. This remains
    // correct when the server binds 0.0.0.0 or sits behind TLS termination.
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
      socket.destroy();
      return;
    }

    const taskId = url.searchParams.get("taskId") ?? "";
    const cols = Math.max(
      20,
      Number.parseInt(url.searchParams.get("cols") ?? "80", 10) || 80,
    );
    const rows = Math.max(
      5,
      Number.parseInt(url.searchParams.get("rows") ?? "24", 10) || 24,
    );
    const task = store.get(taskId);
    if (!task) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let s: import("./pty_session.js").PtySession;
      try {
        s = runtime.ensurePtyForTask(taskId, cols, rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[autoloop-kanban] PTY spawn failed task=${taskId} — ${msg}\n`,
        );
        try {
          ws.close(4001, "pty spawn failed");
        } catch {
          /* already closed */
        }
        return;
      }
      s.attach(ws);
      s.resize(cols, rows);
      ws.on("message", (raw) => {
        const str =
          typeof raw === "string"
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString("utf-8")
              : String(raw);
        if (str.startsWith("{")) {
          try {
            const msg = JSON.parse(str);
            if (
              msg?.type === "resize" &&
              typeof msg.cols === "number" &&
              typeof msg.rows === "number"
            ) {
              s.resize(msg.cols, msg.rows);
              return;
            }
          } catch {
            /* fall through — treat as stdin */
          }
        }
        s.write(str);
      });
    });
  };
  server.on("upgrade", onUpgrade);
  return {
    close: () => {
      server.off("upgrade", onUpgrade);
      try {
        wss.close();
      } catch {
        /* already closed */
      }
    },
  };
}
