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

function requestScheme(req: IncomingMessage): "http" | "https" {
  const socket = req.socket as { encrypted?: boolean };
  if (socket.encrypted) return "https";

  // Single trusted hop only: first X-Forwarded-Proto value. Used when TLS is
  // terminated in front of a plain HTTP Node listener (common reverse-proxy).
  const forwarded = req.headers["x-forwarded-proto"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const proto = raw?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return "https";
  if (proto === "http") return "http";
  return "http";
}

function isOriginAllowed(
  requestOrigin: string | undefined,
  requestHost: string | undefined,
  scheme: "http" | "https",
): boolean {
  // Non-browser/native clients often omit Origin. Preserve that behavior while
  // rejecting cross-origin browser upgrades.
  if (!requestOrigin) return true;
  if (!requestHost) return false;

  try {
    const originUrl = new URL(requestOrigin);
    // Require a true same-origin match: scheme + host[:port]. Reject values
    // that are merely same-host across http/https, and reject non-origin forms.
    return (
      originUrl.origin === requestOrigin &&
      originUrl.protocol === `${scheme}:` &&
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

    // Validate browser Origin as true same-origin against Host + request scheme
    // (socket TLS or first X-Forwarded-Proto hop for reverse-proxy termination).
    if (
      !isOriginAllowed(req.headers.origin, req.headers.host, requestScheme(req))
    ) {
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
