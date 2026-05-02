import type { Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import {
  installKanban,
  type KanbanContext,
  TaskStore,
} from "@mobrienv/autoloop-kanban";
import type { Hono } from "hono";
import { listPresetsWithDescriptions } from "../chains/load.js";

export function dispatchKanban(
  args: string[],
  bundleRoot: string,
  selfCmd: string,
): void {
  let port = 4801;
  let host = "127.0.0.1";
  let projectDir = ".";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--port" || arg === "-p") && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--host" && args[i + 1]) {
      host = args[i + 1];
      i++;
    } else if (arg === "--project-dir" && args[i + 1]) {
      projectDir = args[i + 1];
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      return;
    }
  }

  const resolved = resolve(projectDir);
  const stateDir = join(resolved, ".autoloop");
  const autoloopBin = selfCmd.replace(/^'(.*)'$/, "$1");

  const ctx: KanbanContext = {
    projectDir: resolved,
    stateDir,
    bundleRoot,
    selfCmd,
    autoloopBin,
    host,
    port,
    listPresets: (dir) => listPresetsWithDescriptions(dir),
  };

  const store = new TaskStore({ runId: `kanban-${process.pid}` });

  let app: Hono | null = null;
  // createAdaptorServer returns Server | Http2Server | Http2SecureServer; with
  // no secure/http2 options it is a node:http.Server at runtime. installKanban
  // requires the http.Server handle to attach its WS upgrade listener.
  const server = createAdaptorServer({
    fetch: (req, ...rest) => {
      if (!app)
        return new Response("kanban not yet installed", { status: 503 });
      return app.fetch(req, ...rest);
    },
    port,
    hostname: host,
  }) as HttpServer;

  const { app: builtApp, close } = installKanban(server, ctx, store);
  app = builtApp;

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, host, () => {
    const addr = server.address();
    const bound =
      addr && typeof addr !== "string"
        ? `http://${addr.address}:${addr.port}`
        : `http://${host}:${port}`;
    if (process.stderr.isTTY) {
      console.error(`autoloop kanban → ${bound}`);
    }
    console.log(`Kanban listening on ${bound}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down kanban...");
    try {
      close();
    } catch {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printUsage(): void {
  console.log("Usage: autoloop kanban [options]");
  console.log("");
  console.log("Options:");
  console.log("  --port, -p <port>       Port to listen on (default: 4801)");
  console.log("  --host <host>           Host to bind to (default: 127.0.0.1)");
  console.log("  --project-dir <dir>     Project directory (default: .)");
  console.log("  --help, -h              Show this help");
}
