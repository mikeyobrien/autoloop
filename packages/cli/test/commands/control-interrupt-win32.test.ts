// AC6 (docs/rfcs/windows-support.md): `autoloop control interrupt <run>` on
// Windows stops the current iteration of a running loop and does not throw.
// Windows cannot deliver SIGUSR1, so the CLI only queues the request and the
// harness drains the queue on a timer, then terminates the command child's
// process tree. The win32 branches are injected so the same flow runs on
// Linux; on Windows the real taskkill ends a real child.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KillTreeDeps } from "@mobrienv/autoloop-core";
import { buildControlAdapter } from "@mobrienv/autoloop-harness";
import { buildLoopContext } from "@mobrienv/autoloop-harness/config-helpers";
import {
  drainControlRequests,
  installControlDrainTrigger,
  publishCapabilities,
  readStatuses,
} from "@mobrienv/autoloop-harness/control";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchControl, pokeParent } from "../../src/commands/control.js";

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`child still running after ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("control interrupt on win32 (AC6)", () => {
  let projectDir: string;
  let child: ChildProcess;
  let killSpy: MockInstance<typeof process.kill>;
  let logs: string[];
  const prevProjectDir = process.env.AUTOLOOP_PROJECT_DIR;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-ctl-win32-"));
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'event_loop.max_iterations = 1\n\n[backend]\nkind = "command"\ncommand = "node"\n',
    );
    writeFileSync(
      join(projectDir, "topology.toml"),
      '[[role]]\nname = "builder"\n',
    );
    // Stand-in for the in-flight `command` iteration.
    child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
      stdio: "ignore",
    });
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    // Record the CLI's poke without signalling anything.
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    process.env.AUTOLOOP_PROJECT_DIR = projectDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (prevProjectDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
    else process.env.AUTOLOOP_PROJECT_DIR = prevProjectDir;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("queues the request, drains it on the poll timer, and terminates the command child", async () => {
    const loop = buildLoopContext(projectDir, "interrupt me", "autoloop", {
      workDir: projectDir,
    });
    const pid = child.pid as number;
    loop.commandSession.current = { pid };
    const taskkill = vi.fn((target: number) => {
      // Linux stand-in for `taskkill /T /F`; Windows uses the real one.
      if (target === pid) child.kill("SIGKILL");
      return 0;
    });
    const killDeps: KillTreeDeps | undefined =
      process.platform === "win32"
        ? undefined
        : { platform: "win32", killGroup: vi.fn(), taskkill };
    const adapter = buildControlAdapter(loop, killDeps);
    if (!adapter) throw new Error("command backend must expose an adapter");
    loop.controlAdapter = adapter;
    publishCapabilities(loop.paths.stateDir, adapter);

    writeFileSync(
      join(projectDir, ".autoloop", "registry.jsonl"),
      `${JSON.stringify({
        run_id: loop.runtime.runId,
        status: "running",
        preset: "autocode",
        objective: "interrupt me",
        trigger: "cli",
        project_dir: projectDir,
        work_dir: projectDir,
        state_dir: loop.paths.stateDir,
        journal_file: loop.paths.journalFile,
        parent_run_id: "",
        backend: "node",
        backend_args: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        iteration: 1,
        max_iterations: 1,
        stop_reason: "",
        latest_event: "",
        isolation_mode: loop.runtime.isolationMode,
        worktree_name: "",
        worktree_path: "",
        pid: process.pid,
      })}\n`,
    );

    const stopDrain = installControlDrainTrigger(
      () => drainControlRequests(loop.paths.stateDir, adapter),
      "win32",
    );
    try {
      dispatchControl(["capabilities", loop.runtime.runId]);
      expect(logs.join("\n")).toContain("not available on Windows");

      expect(() =>
        dispatchControl(["interrupt", loop.runtime.runId]),
      ).not.toThrow();
      expect(logs.join("\n")).toContain(
        `Interrupt requested for ${loop.runtime.runId}`,
      );
      if (process.platform === "win32") {
        expect(killSpy).not.toHaveBeenCalledWith(process.pid, "SIGUSR1");
      }

      await waitForExit(child, 5000);
      if (process.platform !== "win32") {
        expect(taskkill).toHaveBeenCalledWith(pid);
      }
      expect(readStatuses(loop.paths.stateDir)[0]?.state).toBe("applied");
    } finally {
      stopDrain();
    }
  });
});

describe("pokeParent", () => {
  const run = { run_id: "run-1", status: "running", pid: 4242 } as Parameters<
    typeof pokeParent
  >[0];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends SIGUSR1 to the running harness on POSIX", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    pokeParent(run, "linux");
    expect(kill).toHaveBeenCalledWith(4242, "SIGUSR1");
  });

  it("swallows a kill failure (the parent may have exited)", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(() => pokeParent(run, "linux")).not.toThrow();
  });

  it("does not signal on win32 (the harness polls the queue)", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    pokeParent(run, "win32");
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not signal a run that is not running", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    pokeParent({ ...run, status: "completed" }, "linux");
    pokeParent({ ...run, pid: undefined }, "linux");
    expect(kill).not.toHaveBeenCalled();
  });
});
