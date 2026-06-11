import { type FSWatcher, statSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { Hono } from "hono";
import type { DashboardContext } from "../app.js";
import { buildRunsPayload } from "./api.js";

/** SSE comment frame sent periodically so proxies keep the connection open. */
export const KEEPALIVE_FRAME = ": keepalive\n\n";
export const KEEPALIVE_INTERVAL_MS = 25_000;
export const WATCH_DEBOUNCE_MS = 250;
export const POLL_INTERVAL_MS = 2_000;

/**
 * Serialize a Server-Sent Events frame. Multi-line data is split into one
 * `data:` line per line, per the SSE spec.
 */
export function buildSseFrame(event: string, data: string): string {
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `event: ${event}\n${dataLines}\n\n`;
}

export interface RegistryWatcher {
  close(): void;
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * Watch the registry file for changes, debouncing bursts of writes.
 *
 * Prefers `fs.watch` on the registry's parent directory so a not-yet-existing
 * registry file is picked up on creation. Falls back to polling the file's
 * mtime when `fs.watch` is unavailable (parent directory missing, or the
 * platform watcher errors at runtime).
 *
 * All timers and watchers are unref'd so an open SSE connection never keeps
 * the process alive past server close.
 */
export function watchRegistry(
  registryPath: string,
  onChange: () => void,
  opts: { debounceMs?: number; pollMs?: number } = {},
): RegistryWatcher {
  const debounceMs = opts.debounceMs ?? WATCH_DEBOUNCE_MS;
  const pollMs = opts.pollMs ?? POLL_INTERVAL_MS;
  const dir = dirname(registryPath);
  const fileName = basename(registryPath);

  let closed = false;
  let watcher: FSWatcher | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMtimeMs = mtimeOf(registryPath);

  const fire = (): void => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      if (!closed) onChange();
    }, debounceMs);
    debounceTimer.unref?.();
  };

  const startPolling = (): void => {
    if (closed || pollTimer) return;
    pollTimer = setInterval(() => {
      const mtime = mtimeOf(registryPath);
      if (mtime !== lastMtimeMs) {
        lastMtimeMs = mtime;
        fire();
      }
    }, pollMs);
    pollTimer.unref?.();
  };

  try {
    watcher = watch(dir, (_eventType, changed) => {
      // Some platforms report a null filename; refresh conservatively then.
      if (changed === null || changed === fileName) fire();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
      startPolling();
    });
    watcher.unref();
  } catch {
    startPolling();
  }

  return {
    close(): void {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
      watcher?.close();
    },
  };
}

export function streamRoutes(ctx: DashboardContext): Hono {
  const routes = new Hono();

  routes.get("/stream", (c) => {
    const encoder = new TextEncoder();
    let watcher: RegistryWatcher | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      watcher?.close();
      watcher = undefined;
      if (keepalive) clearInterval(keepalive);
      keepalive = undefined;
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (frame: string): void => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // Client went away mid-write; tear everything down.
            cleanup();
          }
        };
        const pushRuns = (): void =>
          send(buildSseFrame("runs", JSON.stringify(buildRunsPayload(ctx))));

        pushRuns();
        watcher = watchRegistry(ctx.registryPath, pushRuns);
        keepalive = setInterval(
          () => send(KEEPALIVE_FRAME),
          KEEPALIVE_INTERVAL_MS,
        );
        keepalive.unref?.();

        c.req.raw.signal?.addEventListener(
          "abort",
          () => {
            cleanup();
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
          { once: true },
        );
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return routes;
}
