import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import type { DashboardContext } from "../src/app.js";
import { createApp } from "../src/app.js";

function makeCtx(selfCmd: string): DashboardContext {
  const projectDir = mkdtempSync(join(tmpdir(), "dashboard-api-spawn-test-"));
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
    selfCmd,
    listPresets: () => [],
  };
}

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 12345, unref: vi.fn() });
  return child;
}

describe("POST /api/runs process launch", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeChild());
  });

  it("keeps the dashboard alive when the child process cannot start", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = createApp(makeCtx("/missing/autoloop"));

    const response = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "build a widget" }),
    });

    expect(response.status).toBe(202);
    expect(() => child.emit("error", new Error("spawn failed"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to spawn dashboard run: spawn failed",
    );
    errorSpy.mockRestore();
  });

  it("passes a quoted node command as executable plus entrypoint argument", async () => {
    const ctx = makeCtx(
      "'/opt/Node Runtime/bin/node' '/opt/Auto Loop/bin/autoloop.js'",
    );
    const app = createApp(ctx);

    const response = await app.request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "build a widget" }),
    });

    expect(response.status).toBe(202);
    expect(spawnMock).toHaveBeenCalledWith(
      "/opt/Node Runtime/bin/node",
      ["/opt/Auto Loop/bin/autoloop.js", "run", "build a widget"],
      {
        cwd: ctx.projectDir,
        detached: true,
        stdio: "ignore",
      },
    );
  });
});
