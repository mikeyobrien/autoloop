import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp, type DashboardContext } from "../../src/dashboard/app.js";

function makeCtx(overrides: Partial<DashboardContext> = {}): DashboardContext {
  const projectDir = mkdtempSync(join(tmpdir(), "dashboard-pages-test-"));
  const stateDir = join(projectDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "registry.jsonl"), "", "utf-8");
  writeFileSync(join(stateDir, "journal.jsonl"), "", "utf-8");
  return {
    registryPath: join(stateDir, "registry.jsonl"),
    journalPath: join(stateDir, "journal.jsonl"),
    stateDir,
    bundleRoot: projectDir,
    projectDir,
    selfCmd: "autoloop",
    ...overrides,
  };
}

describe("page routes", () => {
  it("GET / returns HTML with expected markers", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('x-data="dashboard()"');
    expect(html).toContain("alpine");
  });

  it("textarea has Cmd+Enter and Ctrl+Enter shortcuts", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('@keydown.meta.enter="startLoop()"');
    expect(html).toContain('@keydown.ctrl.enter="startLoop()"');
  });

  it("GET /static/alpine.min.js returns JavaScript", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/static/alpine.min.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });
});

describe("API response wrapping", () => {
  it("GET /api/runs/:id/events returns { events }", async () => {
    const ctx = makeCtx();
    // Write a journal line so we get something back
    writeFileSync(ctx.journalPath, `${JSON.stringify({ type: "test" })}\n`);
    const app = createApp(ctx);
    const res = await app.request("/api/runs/fake-id/events");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("events");
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("GET /api/presets returns { presets }", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/api/presets");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("presets");
    expect(Array.isArray(body.presets)).toBe(true);
  });
});

describe("origin-check middleware", () => {
  it("rejects mismatched Origin when host is non-localhost", async () => {
    const app = createApp(makeCtx({ host: "192.168.1.10", port: 4800 }));
    const res = await app.request("/api/runs", {
      headers: { Origin: "http://evil.example.com" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("origin mismatch");
  });

  it("allows requests without Origin header on non-localhost", async () => {
    const app = createApp(makeCtx({ host: "192.168.1.10", port: 4800 }));
    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
  });

  it("allows matching Origin on non-localhost", async () => {
    const app = createApp(makeCtx({ host: "192.168.1.10", port: 4800 }));
    const res = await app.request("/api/runs", {
      headers: { Origin: "http://192.168.1.10:4800" },
    });
    expect(res.status).toBe(200);
  });

  it("does not apply origin check when host is 127.0.0.1", async () => {
    const app = createApp(makeCtx({ host: "127.0.0.1" }));
    const res = await app.request("/api/runs", {
      headers: { Origin: "http://evil.example.com" },
    });
    // Should pass through — no origin check on localhost
    expect(res.status).toBe(200);
  });
});

describe("POST /api/runs input validation", () => {
  it("returns 400 for empty prompt", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("returns 400 for prompt exceeding 10K chars", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(10_001) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("returns 400 for invalid preset", async () => {
    const app = createApp(makeCtx());
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "hello",
        preset: "nonexistent-preset-xyz",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unknown preset");
  });

  it("returns 202 for valid prompt without preset", async () => {
    // Mock spawn to avoid actually launching a process
    const { spawn } = await import("node:child_process");
    vi.mock("node:child_process", async (importOriginal) => {
      const orig = await importOriginal<typeof import("node:child_process")>();
      return {
        ...orig,
        spawn: vi.fn(() => ({
          pid: 12345,
          unref: vi.fn(),
        })),
      };
    });

    const app = createApp(makeCtx());
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "build a widget" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("accepted");

    vi.restoreAllMocks();
  });
});
