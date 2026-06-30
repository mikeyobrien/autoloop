// Dashboard lifecycle control for the ACP console.
//
// The `/dashboard` slash command starts (or stops) the local dashboard HTTP
// server in-process and returns the URL so an ACP client can render it as a
// clickable link. Unlike the standalone `autoloop dashboard` command, this
// never installs process signal handlers or calls process.exit — the ACP
// process owns the lifecycle and stops the server on demand or at shutdown.

import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import type { DashboardContext } from "@mobrienv/autoloop-dashboard";
import { createApp } from "@mobrienv/autoloop-dashboard";
import { listPresetsWithDescriptions } from "../chains/load.js";

interface RunningDashboard {
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
}

export interface DashboardControlOptions {
  bundleRoot: string;
  selfCmd: string;
  /**
   * Fallback project directory used when `dispatch`/`start` is not given a
   * per-session one (e.g. the launch-time --project-dir default).
   */
  projectDir: string;
}

export interface DashboardActionResult {
  ok: boolean;
  /** Human-readable text returned to the ACP client. */
  message: string;
  /** Dashboard URL when one is running, for clickable rendering. */
  url?: string;
}

/**
 * Singleton manager for the dashboard server within one ACP process. Only one
 * dashboard runs at a time; `start` on an already-running dashboard returns the
 * existing URL.
 */
export class DashboardControl {
  private current: RunningDashboard | null = null;
  private readonly opts: DashboardControlOptions;

  constructor(opts: DashboardControlOptions) {
    this.opts = opts;
  }

  /** Parse args and dispatch start/stop/status. */
  async dispatch(
    args: string[],
    projectDir?: string,
  ): Promise<DashboardActionResult> {
    const { action, port, host } = parseArgs(args);
    if (action === "stop") return this.stop();
    if (action === "status") return this.status();
    return this.start(port, host, projectDir);
  }

  async start(
    port: number,
    host: string,
    projectDir?: string,
  ): Promise<DashboardActionResult> {
    if (this.current) {
      return {
        ok: true,
        message: `Dashboard already running at ${this.current.url}`,
        url: this.current.url,
      };
    }

    try {
      const running = await this.listen(port, host, projectDir);
      this.current = running;
      return {
        ok: true,
        message: `Dashboard started at ${running.url}`,
        url: running.url,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Failed to start dashboard: ${errText(err)}`,
      };
    }
  }

  async stop(): Promise<DashboardActionResult> {
    if (!this.current) {
      return { ok: true, message: "No dashboard is running" };
    }
    const url = this.current.url;
    await this.current.close();
    this.current = null;
    return { ok: true, message: `Dashboard stopped (${url})` };
  }

  status(): DashboardActionResult {
    if (!this.current) {
      return { ok: true, message: "No dashboard is running" };
    }
    return {
      ok: true,
      message: `Dashboard running at ${this.current.url}`,
      url: this.current.url,
    };
  }

  /** Stop any running dashboard. Safe to call at process shutdown. */
  async shutdown(): Promise<void> {
    if (this.current) {
      await this.current.close();
      this.current = null;
    }
  }

  private listen(
    port: number,
    host: string,
    projectDir?: string,
  ): Promise<RunningDashboard> {
    const resolved = resolve(projectDir ?? this.opts.projectDir);
    const stateDir = join(resolved, ".autoloop");
    const ctx: DashboardContext = {
      registryPath: join(stateDir, "registry.jsonl"),
      journalPath: join(stateDir, "journal.jsonl"),
      stateDir,
      bundleRoot: this.opts.bundleRoot,
      projectDir: resolved,
      selfCmd: this.opts.selfCmd,
      listPresets: (dir) => listPresetsWithDescriptions(dir),
    };
    const app = createApp({ ...ctx, host, port });

    return new Promise<RunningDashboard>((resolvePromise, reject) => {
      let settled = false;
      const server = serve(
        { fetch: app.fetch, port, hostname: host },
        (info) => {
          settled = true;
          const url = `http://${displayHost(host)}:${info.port}`;
          resolvePromise({
            url,
            port: info.port,
            host,
            close: () =>
              new Promise<void>((res) => {
                server.close(() => res());
              }),
          });
        },
      );
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        if (err.code === "EADDRINUSE") {
          reject(new Error(`port ${port} is already in use`));
          return;
        }
        reject(err);
      });
    });
  }
}

interface ParsedDashboardArgs {
  action: "start" | "stop" | "status";
  port: number;
  host: string;
}

export function parseArgs(args: string[]): ParsedDashboardArgs {
  let action: ParsedDashboardArgs["action"] = "start";
  let port = 4800;
  let host = "127.0.0.1";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "start" || arg === "stop" || arg === "status") {
      action = arg;
    } else if ((arg === "--port" || arg === "-p") && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed)) port = parsed;
      i++;
    } else if (arg === "--host" && args[i + 1]) {
      host = args[i + 1];
      i++;
    }
  }
  return { action, port, host };
}

function displayHost(host: string): string {
  // 0.0.0.0 isn't directly clickable; point the link at localhost.
  if (host === "0.0.0.0" || host === "::") return "localhost";
  return host;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
