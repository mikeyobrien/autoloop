import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DashboardControl,
  parseArgs,
} from "../../src/acp/dashboard-control.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

function makeControl(): DashboardControl {
  const projectDir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-dash-"));
  return new DashboardControl({ bundleRoot, selfCmd: "autoloop", projectDir });
}

describe("parseArgs", () => {
  it("defaults to start on 127.0.0.1:4800", () => {
    expect(parseArgs([])).toEqual({
      action: "start",
      port: 4800,
      host: "127.0.0.1",
    });
  });
  it("parses action, port, and host", () => {
    expect(parseArgs(["stop"])).toMatchObject({ action: "stop" });
    expect(parseArgs(["status"])).toMatchObject({ action: "status" });
    expect(parseArgs(["start", "--port", "3000", "--host", "0.0.0.0"])).toEqual(
      { action: "start", port: 3000, host: "0.0.0.0" },
    );
    expect(parseArgs(["-p", "5555"]).port).toBe(5555);
  });
  it("ignores a non-numeric port", () => {
    expect(parseArgs(["--port", "abc"]).port).toBe(4800);
  });
});

describe("DashboardControl", () => {
  let control: DashboardControl | null = null;
  afterEach(async () => {
    await control?.shutdown();
    control = null;
  });

  it("starts and returns a clickable URL, then reports running on status", async () => {
    control = makeControl();
    const started = await control.dispatch(["start", "--port", "0"]);
    expect(started.ok).toBe(true);
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const status = control.status();
    expect(status.url).toBe(started.url);
    expect(status.message).toContain("running");
  });

  it("returns the existing URL when already running", async () => {
    control = makeControl();
    const first = await control.start(0, "127.0.0.1");
    const second = await control.start(0, "127.0.0.1");
    expect(second.message).toContain("already running");
    expect(second.url).toBe(first.url);
  });

  it("stop reports no dashboard when none running", async () => {
    control = makeControl();
    const stopped = await control.dispatch(["stop"]);
    expect(stopped.ok).toBe(true);
    expect(stopped.message).toContain("No dashboard");
  });

  it("status reports none when not running", () => {
    control = makeControl();
    expect(control.status().message).toContain("No dashboard");
  });

  it("starts then stops", async () => {
    control = makeControl();
    await control.start(0, "127.0.0.1");
    const stopped = await control.stop();
    expect(stopped.message).toContain("stopped");
    expect(control.status().message).toContain("No dashboard");
  });

  it("starts on a per-call project directory when provided", async () => {
    control = makeControl();
    const dir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-dash-call-"));
    const started = await control.dispatch(["start", "--port", "0"], dir);
    expect(started.ok).toBe(true);
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("maps 0.0.0.0 host to a localhost URL", async () => {
    control = makeControl();
    const started = await control.start(0, "0.0.0.0");
    expect(started.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("reports failure when the port is already in use", async () => {
    control = makeControl();
    const first = await control.start(0, "127.0.0.1");
    const port = Number(new URL(first.url as string).port);
    const other = makeControl();
    try {
      const result = await other.start(port, "127.0.0.1");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("already in use");
    } finally {
      await other.shutdown();
    }
  });
});
