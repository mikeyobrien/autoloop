import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import type { DashboardContext } from "../dashboard/app.js";
import { createApp } from "../dashboard/app.js";

export function dispatchDashboard(
  args: string[],
  bundleRoot: string,
  selfCmd: string,
): void {
  let port = 4800;
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

  const ctx: DashboardContext = {
    registryPath: join(stateDir, "registry.jsonl"),
    journalPath: join(stateDir, "journal.jsonl"),
    stateDir,
    bundleRoot,
    projectDir: resolved,
    selfCmd,
  };

  const app = createApp({ ...ctx, host, port });

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    if (process.stderr.isTTY) {
      console.error(`autoloop dashboard → http://${info.address}:${info.port}`);
    }
    console.log(`Dashboard listening on http://${info.address}:${info.port}`);
  });

  const shutdown = () => {
    console.log("\nShutting down dashboard...");
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use.`);
      process.exit(1);
    }
    throw err;
  });
}

function printUsage(): void {
  console.log("Usage: autoloop dashboard [options]");
  console.log("");
  console.log("Options:");
  console.log("  --port, -p <port>       Port to listen on (default: 4800)");
  console.log("  --host <host>           Host to bind to (default: 127.0.0.1)");
  console.log("  --project-dir <dir>     Project directory (default: .)");
  console.log("  --help, -h              Show this help");
}
