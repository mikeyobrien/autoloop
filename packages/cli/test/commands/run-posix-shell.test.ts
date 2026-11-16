// AC7 (docs/rfcs/windows-support.md): with no POSIX shell on Windows
// (AUTOLOOP_SHELL set to a missing file), `autoloop run` exits non-zero with
// the PosixShellNotFoundError message before any run starts. On Windows the
// real resolver runs; elsewhere the win32 search is forced (git lookup
// disabled) so the same failure path is exercised on Linux.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSpy = vi.fn();
vi.mock("@mobrienv/autoloop-harness", () => ({
  run: (...args: unknown[]) => runSpy(...args),
}));

vi.mock("@mobrienv/autoloop-core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@mobrienv/autoloop-core")>();
  return {
    ...core,
    resolvePosixShell: (env: NodeJS.ProcessEnv = process.env) => {
      if (process.platform === "win32") {
        core.resetPosixShellCache();
        return core.resolvePosixShell(env);
      }
      return core.findPosixShell({
        platform: "win32",
        env,
        exists: existsSync,
        gitExecPath: () => undefined,
      });
    },
  };
});

import { dispatchRun } from "../../src/commands/run.js";

describe("autoloop run without a POSIX shell (AC7)", () => {
  let projectDir: string;
  let stderr: string[];
  const prevShell = process.env.AUTOLOOP_SHELL;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-run-noshell-"));
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      "[event_loop]\nmax_iterations = 1\n",
    );
    process.env.AUTOLOOP_SHELL = join(projectDir, "missing", "sh.exe");
    process.exitCode = undefined;
    runSpy.mockReset();
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (prevShell === undefined) delete process.env.AUTOLOOP_SHELL;
    else process.env.AUTOLOOP_SHELL = prevShell;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("exits non-zero with the PosixShellNotFoundError message", async () => {
    await dispatchRun([projectDir, "say hi"], [], projectDir, "autoloop");

    const exitCode = process.exitCode;
    process.exitCode = undefined;
    expect(exitCode).toBe(2);
    const output = stderr.join("");
    expect(output).toContain("autoloop needs a POSIX shell (sh.exe)");
    expect(output).toContain(
      `AUTOLOOP_SHELL=${join(projectDir, "missing", "sh.exe")}`,
    );
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("writes terminal error events when --events was given", async () => {
    const eventsPath = join(projectDir, "events.ndjson");
    await dispatchRun(
      [projectDir, "say hi", "--events", eventsPath],
      [],
      projectDir,
      "autoloop",
    );
    process.exitCode = undefined;

    const events = readFileSync(eventsPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({ type: "log", level: "error" });
    expect(events[0].message).toContain("autoloop needs a POSIX shell");
    expect(events[1]).toMatchObject({
      type: "loop.finish",
      stopReason: "error",
    });
    expect(runSpy).not.toHaveBeenCalled();
  });
});
