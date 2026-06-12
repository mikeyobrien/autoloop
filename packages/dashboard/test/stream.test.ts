import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type DashboardContext } from "@mobrienv/autoloop-dashboard";
import { describe, expect, it } from "vitest";
import {
  buildSseFrame,
  KEEPALIVE_FRAME,
  watchRegistry,
} from "../src/routes/stream.js";
import { htmlShell } from "../src/views/shell.js";

function makeCtx(): DashboardContext & { registryPath: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "dashboard-stream-test-"));
  const stateDir = join(projectDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  return {
    registryPath: join(stateDir, "registry.jsonl"),
    journalPath: join(stateDir, "journal.jsonl"),
    stateDir,
    bundleRoot: projectDir,
    projectDir,
    selfCmd: "autoloop",
    listPresets: () => [],
  };
}

function makeRecord(ctx: DashboardContext, runId: string): string {
  const updatedAt = new Date().toISOString();
  return JSON.stringify({
    run_id: runId,
    status: "running",
    preset: "autocode",
    objective: "stream test",
    trigger: "cli",
    project_dir: ctx.projectDir,
    work_dir: ctx.projectDir,
    state_dir: ctx.stateDir,
    journal_file: ctx.journalPath,
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: updatedAt,
    updated_at: updatedAt,
    iteration: 1,
    max_iterations: 10,
    stop_reason: "",
    latest_event: "iteration.finish",
  });
}

/** Incrementally read SSE frames (separated by a blank line) from a Response. */
function frameReader(res: Response) {
  const body = res.body as ReadableStream<Uint8Array>;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return {
    async next(timeoutMs = 5000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const idx = buf.indexOf("\n\n");
        if (idx !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          return frame;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("timed out waiting for SSE frame");
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            const t = setTimeout(
              () => reject(new Error("timed out waiting for SSE frame")),
              remaining,
            );
            t.unref?.();
          }),
        ]);
        if (result.done) throw new Error("stream ended unexpectedly");
        buf += decoder.decode(result.value, { stream: true });
      }
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  };
}

function parseRunsFrame(frame: string): { event: string; data: unknown } {
  const lines = frame.split("\n");
  const eventLine = lines.find((l) => l.startsWith("event: "));
  const data = lines
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length))
    .join("\n");
  return {
    event: eventLine ? eventLine.slice("event: ".length) : "",
    data: JSON.parse(data),
  };
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("buildSseFrame", () => {
  it("serializes event name and single-line data", () => {
    expect(buildSseFrame("runs", '{"active":[]}')).toBe(
      'event: runs\ndata: {"active":[]}\n\n',
    );
  });

  it("splits multi-line data into one data: line per line", () => {
    expect(buildSseFrame("runs", "a\nb\nc")).toBe(
      "event: runs\ndata: a\ndata: b\ndata: c\n\n",
    );
  });

  it("keepalive frame is an SSE comment terminated by a blank line", () => {
    expect(KEEPALIVE_FRAME).toBe(": keepalive\n\n");
    expect(KEEPALIVE_FRAME.startsWith(":")).toBe(true);
  });
});

describe("watchRegistry", () => {
  it("fires onChange (debounced once) when the registry file changes", async () => {
    const ctx = makeCtx();
    writeFileSync(ctx.registryPath, "", "utf-8");
    let calls = 0;
    const watcher = watchRegistry(ctx.registryPath, () => calls++, {
      debounceMs: 100,
    });
    try {
      // fs.watch registration is asynchronous (fsevents on macOS): a write
      // that lands before the watcher is live is silently missed. Nudge the
      // file on an interval longer than the debounce window until the first
      // event proves the watcher is live, then test coalescing separately.
      const nudge = setInterval(
        () => appendFileSync(ctx.registryPath, "nudge\n", "utf-8"),
        300,
      );
      try {
        await waitFor(() => calls >= 1, 10000);
      } finally {
        clearInterval(nudge);
      }
      // Drain any pending debounce window from the nudges.
      await new Promise((r) => setTimeout(r, 400));
      const base = calls;

      // Burst of writes should coalesce into a single onChange.
      appendFileSync(ctx.registryPath, "line-1\n", "utf-8");
      appendFileSync(ctx.registryPath, "line-2\n", "utf-8");
      await waitFor(() => calls > base, 10000);
      await new Promise((r) => setTimeout(r, 400));
      expect(calls).toBe(base + 1);
    } finally {
      watcher.close();
    }
  });

  it("falls back to mtime polling when the parent directory does not exist", async () => {
    const base = mkdtempSync(join(tmpdir(), "dashboard-stream-poll-"));
    const registryPath = join(base, "missing-dir", "registry.jsonl");
    let calls = 0;
    const watcher = watchRegistry(registryPath, () => calls++, {
      debounceMs: 20,
      pollMs: 50,
    });
    try {
      // Directory and file appear after the watcher started.
      mkdirSync(join(base, "missing-dir"), { recursive: true });
      writeFileSync(registryPath, "created\n", "utf-8");
      await waitFor(() => calls >= 1, 5000);
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.close();
    }
  });

  it("does not fire after close", async () => {
    const ctx = makeCtx();
    writeFileSync(ctx.registryPath, "", "utf-8");
    let calls = 0;
    const watcher = watchRegistry(ctx.registryPath, () => calls++, {
      debounceMs: 20,
    });
    watcher.close();
    appendFileSync(ctx.registryPath, "after-close\n", "utf-8");
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(0);
  });
});

describe("GET /api/stream", () => {
  it("sends SSE headers and an initial runs event matching /api/runs", async () => {
    const ctx = makeCtx();
    writeFileSync(ctx.registryPath, `${makeRecord(ctx, "run-sse-001")}\n`);
    const app = createApp(ctx);

    const res = await app.request("/api/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");

    const reader = frameReader(res);
    try {
      const frame = parseRunsFrame(await reader.next());
      expect(frame.event).toBe("runs");

      const expectedRes = await app.request("/api/runs");
      const expected = await expectedRes.json();
      expect(frame.data).toEqual(expected);

      const allRuns = Object.values(
        frame.data as Record<string, { run_id: string }[]>,
      ).flat();
      expect(allRuns.some((r) => r.run_id === "run-sse-001")).toBe(true);
    } finally {
      await reader.cancel();
    }
  });

  it("pushes a fresh runs event when the registry changes", async () => {
    const ctx = makeCtx();
    writeFileSync(ctx.registryPath, `${makeRecord(ctx, "run-sse-first")}\n`);
    const app = createApp(ctx);

    const res = await app.request("/api/stream");
    const reader = frameReader(res);
    try {
      const initial = parseRunsFrame(await reader.next());
      expect(initial.event).toBe("runs");

      appendFileSync(
        ctx.registryPath,
        `${makeRecord(ctx, "run-sse-second")}\n`,
        "utf-8",
      );

      // Accept keepalives / intermediate frames until the new run shows up.
      const deadline = Date.now() + 10_000;
      let found = false;
      while (!found && Date.now() < deadline) {
        const raw = await reader.next(deadline - Date.now());
        if (!raw.startsWith("event: runs")) continue;
        const frame = parseRunsFrame(raw);
        const allRuns = Object.values(
          frame.data as Record<string, { run_id: string }[]>,
        ).flat();
        found = allRuns.some((r) => r.run_id === "run-sse-second");
      }
      expect(found).toBe(true);
    } finally {
      await reader.cancel();
    }
  });

  it("streams an initial event even when the registry file does not exist yet", async () => {
    const ctx = makeCtx();
    // registry.jsonl intentionally not created
    const app = createApp(ctx);

    const res = await app.request("/api/stream");
    expect(res.status).toBe(200);
    const reader = frameReader(res);
    try {
      const frame = parseRunsFrame(await reader.next());
      expect(frame.event).toBe("runs");
      const data = frame.data as Record<string, unknown[]>;
      expect(data.active).toEqual([]);
    } finally {
      await reader.cancel();
    }
  });
});

describe("shell SSE client", () => {
  it("connects EventSource to /api/stream and applies runs events", () => {
    const html = htmlShell();
    expect(html).toContain("new EventSource('/api/stream')");
    expect(html).toContain("es.addEventListener('runs'");
    expect(html).toContain("this.applyRuns(JSON.parse(e.data))");
  });

  it("falls back to fetch polling with backoff on EventSource error", () => {
    const html = htmlShell();
    expect(html).toContain("startFallbackPolling()");
    expect(html).toContain("stopFallbackPolling()");
    expect(html).toContain(
      "this.streamRetryDelay = Math.min(delay * 2, 30000)",
    );
    expect(html).toContain("setTimeout(() => this.connectStream(), delay)");
  });
});
