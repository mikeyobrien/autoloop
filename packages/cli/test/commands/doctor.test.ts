import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PosixShellNotFoundError } from "@mobrienv/autoloop-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkPosixShell,
  commandOnPath,
  dispatchDoctor,
  renderDoctorReport,
  runDoctorChecks,
} from "../../src/commands/doctor.js";

function fakeFs(...files: string[]): (path: string) => boolean {
  const lower = new Set(files.map((f) => f.toLowerCase()));
  return (path) => lower.has(path.toLowerCase());
}

function registryLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    run_id: "run-x",
    status: "completed",
    preset: "autocode",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:10:00Z",
    iteration: 3,
    ...overrides,
  });
}

describe("doctor", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-doctor-test-"));
    stateDir = join(projectDir, ".autoloop");
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function check(name: string) {
    const found = runDoctorChecks(projectDir).find((c) => c.name === name);
    expect(found, `check ${name} should exist`).toBeDefined();
    return found as { name: string; status: string; detail: string };
  }

  it("reports ok for a healthy empty state dir", () => {
    expect(check("node").status).toBe("ok");
    expect(check("state").status).toBe("ok");
    expect(check("registry").status).toBe("ok");
    expect(check("runs").status).toBe("ok");
    expect(check("waves").status).toBe("ok");
    expect(check("worktrees").status).toBe("ok");
  });

  it("flags a trivial/un-falsifiable completion contract", () => {
    // No verify_cmds, no required_events, trivial promise → un-falsifiable.
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      '[event_loop]\ncompletion_promise = "done"\n',
    );
    const c = check("completion-contract");
    expect(c.status).toBe("warn");
    expect(c.detail).toContain("unfalsifiable_completion");
  });

  it("passes a well-formed completion contract (deterministic check)", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      '[acceptance]\nverify_cmd = "npm test"\n',
    );
    expect(check("completion-contract").status).toBe("ok");
  });

  it("warns when the state dir does not exist yet", () => {
    rmSync(stateDir, { recursive: true, force: true });
    const checks = runDoctorChecks(projectDir);
    const state = checks.find((c) => c.name === "state");
    expect(state?.status).toBe("warn");
    // State-tree checks are skipped when there is no state tree.
    expect(checks.find((c) => c.name === "registry")).toBeUndefined();
  });

  it("flags runs marked running whose process is gone", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ run_id: "dead-run", status: "running", pid: 2 ** 30 })}\n`,
    );
    const runs = check("runs");
    expect(runs.status).toBe("warn");
    expect(runs.detail).toContain("dead-run");
  });

  it("accepts a running run whose process is alive", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ run_id: "live-run", status: "running", pid: process.pid })}\n`,
    );
    expect(check("runs").status).toBe("ok");
  });

  it("warns about malformed registry lines", () => {
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({})}\nnot-json\n`,
    );
    const registry = check("registry");
    expect(registry.status).toBe("warn");
    expect(registry.detail).toContain("1 malformed");
  });

  it("flags a stale wave marker with no running runs", () => {
    mkdirSync(join(stateDir, "waves"), { recursive: true });
    writeFileSync(join(stateDir, "waves", "active"), "wave-1");
    const waves = check("waves");
    expect(waves.status).toBe("warn");
    expect(waves.detail).toContain("stale wave marker");
  });

  it("accepts a wave marker while a run is alive", () => {
    mkdirSync(join(stateDir, "waves"), { recursive: true });
    writeFileSync(join(stateDir, "waves", "active"), "wave-1");
    writeFileSync(
      join(stateDir, "registry.jsonl"),
      `${registryLine({ status: "running", pid: process.pid })}\n`,
    );
    expect(check("waves").status).toBe("ok");
  });

  it("renders a summary line with counts", () => {
    const report = renderDoctorReport(projectDir, [
      { name: "a", status: "ok", detail: "fine" },
      { name: "b", status: "warn", detail: "meh" },
      { name: "c", status: "fail", detail: "bad" },
    ]);
    expect(report).toContain("autoloop doctor");
    expect(report).toContain("1 failure(s), 1 warning(s)");
  });

  it("dispatch prints JSON with --json", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor([projectDir, "--json"]);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.projectDir).toBe(projectDir);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(0);
  });

  it("dispatch prints a human report by default", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor([projectDir]);
    expect(lines.join("\n")).toContain("autoloop doctor");
  });

  it("dispatch shows usage with --help", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    dispatchDoctor(["--help"]);
    expect(lines.join("\n")).toContain("Usage: autoloop doctor");
  });

  it("reports ok runtime limits when unset", () => {
    const limits = check("runtime limits");
    expect(limits.status).toBe("ok");
    expect(limits.detail).toContain("max_iteration_runtime=off");
    expect(limits.detail).toContain("max_runtime=off");
  });

  it("summarizes configured runtime limits", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      ['event_loop.max_iteration_runtime = "12h"'].join("\n"),
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("ok");
    expect(limits.detail).toContain("max_iteration_runtime=43200000ms");
  });

  it("warns on unparseable runtime limit values", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'event_loop.max_runtime = "forever"\n',
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("not a valid duration");
  });

  it("warns when the iteration cap exceeds the loop budget", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      [
        'event_loop.max_iteration_runtime = "3d"',
        'event_loop.max_runtime = "1h"',
      ].join("\n"),
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("clamped to the remaining loop budget");
  });

  it("warns when a runtime limit exceeds the Node timer cap", () => {
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'event_loop.max_iteration_runtime = "30d"\n',
    );
    const limits = check("runtime limits");
    expect(limits.status).toBe("warn");
    expect(limits.detail).toContain("Node timer limit");
  });

  it("reports the resolved POSIX shell", () => {
    const shell = check("shell");
    expect(shell.status).toBe("ok");
    if (process.platform !== "win32") expect(shell.detail).toBe("/bin/sh");
  });
});

describe("checkPosixShell", () => {
  it("is ok with the resolved shell path", () => {
    expect(checkPosixShell(() => "C:\\Git\\bin\\sh.exe")).toEqual({
      name: "shell",
      status: "ok",
      detail: "C:\\Git\\bin\\sh.exe",
    });
  });

  it("fails with the PosixShellNotFoundError message", () => {
    const error = new PosixShellNotFoundError(["AUTOLOOP_SHELL=C:\\nope.exe"]);
    const result = checkPosixShell(() => {
      throw error;
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toBe(error.message);
    expect(result.detail).toContain("Git for Windows");
    expect(result.detail).toContain("AUTOLOOP_SHELL");
  });

  it("stringifies a non-Error throw", () => {
    const result = checkPosixShell(() => {
      throw "no shell";
    });
    expect(result).toEqual({
      name: "shell",
      status: "fail",
      detail: "no shell",
    });
  });
});

describe("commandOnPath", () => {
  let binDir: string;
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "autoloop-doctor-bin-"));
  });
  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  function touch(name: string): string {
    const path = join(binDir, name);
    writeFileSync(path, "");
    chmodSync(path, 0o755);
    return path;
  }

  it("finds an executable on POSIX PATH", () => {
    touch("claude");
    const env = { PATH: `${binDir}${delimiter}` };
    expect(commandOnPath("claude", env, "linux")).toBe(true);
    expect(commandOnPath("codex", env, "linux")).toBe(false);
    expect(commandOnPath("", env, "linux")).toBe(false);
    expect(commandOnPath("claude", {}, "linux")).toBe(false);
  });

  it("honors PATHEXT on win32", () => {
    const exists = fakeFs("C:\\bin\\claude.cmd", "C:\\bin\\node.exe");
    const env = { PATH: ";C:\\bin", PATHEXT: ".EXE;.CMD" };
    expect(commandOnPath("claude", env, "win32", exists)).toBe(true);
    expect(commandOnPath("node", env, "win32", exists)).toBe(true);
    expect(commandOnPath("claude.cmd", env, "win32", exists)).toBe(true);
    expect(commandOnPath("claude.exe", env, "win32", exists)).toBe(false);
    expect(commandOnPath("codex", env, "win32", exists)).toBe(false);
  });

  it("uses the default PATHEXT and a case-insensitive Path on win32", () => {
    const exists = fakeFs("C:\\bin\\pi.bat");
    expect(commandOnPath("pi", { Path: "C:\\bin" }, "win32", exists)).toBe(
      true,
    );
  });

  it("does not match an extensionless file on win32", () => {
    const exists = fakeFs("C:\\bin\\claude");
    expect(commandOnPath("claude", { PATH: "C:\\bin" }, "win32", exists)).toBe(
      false,
    );
  });

  it("skips relative and quoted-relative PATH entries on win32", () => {
    // Spawns never search these (a planted claude.exe in the cwd must not
    // count), so doctor does not either.
    const exists = (path: string) => /claude\.exe$/i.test(path);
    const env = { PATH: '.;"node_modules\\.bin"', PATHEXT: ".EXE" };
    expect(commandOnPath("claude", env, "win32", exists)).toBe(false);
    const quoted = { PATH: '"C:\\Program Files\\x"', PATHEXT: ".EXE" };
    expect(commandOnPath("claude", quoted, "win32", exists)).toBe(true);
  });

  it("checks a path-qualified command directly", () => {
    // A `/`-qualified path on POSIX (Windows join() would use backslashes).
    const sh = touch("sh").replace(/\\/g, "/");
    expect(commandOnPath(sh, {}, "linux")).toBe(true);
    const exists = fakeFs("C:\\bin\\tool.cmd");
    expect(commandOnPath("C:\\bin\\tool", {}, "win32", exists)).toBe(true);
    expect(commandOnPath("C:/bin/tool", {}, "win32", exists)).toBe(true);
    expect(commandOnPath("C:\\bin\\missing", {}, "win32", exists)).toBe(false);
  });
});
