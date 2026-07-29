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
  clientHost: string,
  clientPort: number,
): boolean {
  // If no origin header, allow (matches HTTP policy; CLI/test clients may omit it).
  if (!requestOrigin) return true;

  // Parse the origin header as a URL.
  let originUrl: URL;
  try {
    originUrl = new URL(requestOrigin);
  } catch {
    // Malformed origin URL — reject.
    return false;
  }

  // Compute allowed origins: localhost forms and the actual bind host:port.
  const allowedOrigins = new Set<string>();
  const actualOrigin = `http://${clientHost}:${clientPort}`;
  allowedOrigins.add(actualOrigin);

  // If bound to localhost/127.0.0.1, also allow the alternate form.
  if (clientHost === "127.0.0.1" || clientHost === "localhost") {
    allowedOrigins.add(`http://127.0.0.1:${clientPort}`);
    allowedOrigins.add(`http://localhost:${clientPort}`);
  }

  // Check if the origin matches one of the allowed origins.
  const requestOriginNorm = `${originUrl.protocol}//${originUrl.host}`;
  return allowedOrigins.has(requestOriginNorm);
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

    // Extract client host and port from the server address.
    // Default to localhost:8000 if unavailable (for testing).
    const serverAddr = server.address();
    let clientHost = "127.0.0.1";
    let clientPort = 8000;
    if (serverAddr && typeof serverAddr !== "string") {
      clientHost = serverAddr.address || "127.0.0.1";
      clientPort = serverAddr.port || 8000;
    }

    // Validate origin (Slice B: WebSocket origin boundary).
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, clientHost, clientPort)) {
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
