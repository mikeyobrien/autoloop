import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canSignalUsr1,
  findOnWindowsPath,
  findPosixShell,
  killProcessTree,
  POSIX_SHELL,
  PosixShellNotFoundError,
  processGroupSpawnOptions,
  resetPosixShellCache,
  resolvePosixShell,
  type ShellProbe,
  taskkillPath,
  windowsEnvValue,
  windowsGitExecPath,
  windowsShellCandidates,
} from "../src/platform.js";

function fakeFs(...files: string[]): (path: string) => boolean {
  const lower = new Set(files.map((f) => f.toLowerCase()));
  return (path) => lower.has(path.toLowerCase());
}

function probe(overrides: Partial<ShellProbe> = {}): ShellProbe {
  return {
    platform: "win32",
    env: {},
    exists: () => false,
    gitExecPath: () => undefined,
    ...overrides,
  };
}

describe("findPosixShell", () => {
  it("returns /bin/sh on non-Windows platforms", () => {
    expect(findPosixShell(probe({ platform: "linux" }))).toBe(POSIX_SHELL);
    expect(findPosixShell(probe({ platform: "darwin" }))).toBe(POSIX_SHELL);
  });

  it("uses AUTOLOOP_SHELL when the file exists", () => {
    const shell = "D:\\tools\\bash.exe";
    const p = probe({
      env: { AUTOLOOP_SHELL: shell },
      exists: (f) => f === shell,
    });
    expect(findPosixShell(p)).toBe(shell);
  });

  it("matches env names case-insensitively", () => {
    const shell = "D:\\tools\\sh.exe";
    const p = probe({
      env: { autoloop_shell: shell },
      exists: (f) => f === shell,
    });
    expect(findPosixShell(p)).toBe(shell);
  });

  it("throws when AUTOLOOP_SHELL points to a missing file", () => {
    const p = probe({ env: { AUTOLOOP_SHELL: "D:\\nope\\sh.exe" } });
    expect(() => findPosixShell(p)).toThrow(PosixShellNotFoundError);
    expect(() => findPosixShell(p)).toThrow(/AUTOLOOP_SHELL=D:\\nope\\sh.exe/);
  });

  it("finds sh.exe from the git exec path", () => {
    const gitExecPath = vi.fn(
      () => "C:\\Program Files\\Git\\mingw64\\libexec\\git-core",
    );
    const env = { PATH: "C:\\Git\\cmd" };
    const p = probe({
      env,
      gitExecPath,
      exists: (f) => f === "C:\\Program Files\\Git\\bin\\sh.exe",
    });
    expect(findPosixShell(p)).toBe("C:\\Program Files\\Git\\bin\\sh.exe");
    // The probe's env drives the git lookup.
    expect(gitExecPath).toHaveBeenCalledWith(env);
  });

  it("lists only bin\\sh.exe per Git root, then absolute PATH entries", () => {
    const env = {
      ProgramFiles: "C:\\PF",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
      PATH: 'C:\\Windows\\System32;.;tools\\bin;"C:\\msys64\\usr\\bin"',
      SystemRoot: "C:\\Windows",
    };
    const candidates = windowsShellCandidates(probe({ env }));
    expect(candidates).toEqual([
      "C:\\PF\\Git\\bin\\sh.exe",
      "C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\sh.exe",
      "C:\\msys64\\usr\\bin\\sh.exe",
      "C:\\msys64\\usr\\bin\\bash.exe",
    ]);
    const p = probe({
      env,
      exists: (f) => f === "C:\\msys64\\usr\\bin\\bash.exe",
    });
    expect(findPosixShell(p)).toBe("C:\\msys64\\usr\\bin\\bash.exe");
  });

  it("never selects a Git usr\\bin\\sh.exe that is not on PATH", () => {
    const p = probe({
      env: { ProgramFiles: "C:\\PF" },
      exists: (f) => f === "C:\\PF\\Git\\usr\\bin\\sh.exe",
    });
    expect(() => findPosixShell(p)).toThrow(PosixShellNotFoundError);
  });

  it("never selects the WSL launcher", () => {
    const env = {
      PATH: "C:\\Windows\\System32;C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps",
    };
    const candidates = windowsShellCandidates(probe({ env }));
    expect(candidates).toEqual([]);
  });

  it("throws an actionable error when nothing exists", () => {
    const p = probe({ env: { ProgramFiles: "C:\\PF" } });
    let error: unknown;
    try {
      findPosixShell(p);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PosixShellNotFoundError);
    const err = error as PosixShellNotFoundError;
    expect(err.message).toMatch(/Git for Windows/);
    expect(err.message).toMatch(/AUTOLOOP_SHELL/);
    expect(err.searched).toContain("C:\\PF\\Git\\bin\\sh.exe");
  });

  it("reports (nothing) when there are no candidates", () => {
    expect(() => findPosixShell(probe())).toThrow(/Searched: \(nothing\)/);
  });
});

describe("resolvePosixShell", () => {
  it("returns a shell for the current platform", () => {
    resetPosixShellCache();
    const shell = resolvePosixShell();
    if (process.platform === "win32") {
      expect(shell.toLowerCase()).toMatch(/(sh|bash)\.exe$/);
      // cached
      expect(resolvePosixShell()).toBe(shell);
    } else {
      expect(shell).toBe(POSIX_SHELL);
    }
  });

  it.skipIf(process.platform !== "win32")(
    "throws on Windows when AUTOLOOP_SHELL is missing",
    () => {
      resetPosixShellCache();
      expect(() =>
        resolvePosixShell({
          ...process.env,
          AUTOLOOP_SHELL: "Z:\\none\\sh.exe",
        }),
      ).toThrow(PosixShellNotFoundError);
      resetPosixShellCache();
    },
  );
});

describe("signals and process groups", () => {
  it("canSignalUsr1 is false only on win32", () => {
    expect(canSignalUsr1("win32")).toBe(false);
    expect(canSignalUsr1("linux")).toBe(true);
    expect(canSignalUsr1()).toBe(process.platform !== "win32");
  });

  it("processGroupSpawnOptions detaches on POSIX and hides windows on win32", () => {
    expect(processGroupSpawnOptions("linux")).toEqual({ detached: true });
    expect(processGroupSpawnOptions("win32")).toEqual({
      detached: false,
      windowsHide: true,
    });
    expect(processGroupSpawnOptions()).toEqual(
      processGroupSpawnOptions(process.platform),
    );
  });

  it("killProcessTree kills the process group on POSIX", () => {
    const calls: Array<[number, string]> = [];
    const ok = killProcessTree(42, "SIGKILL", {
      platform: "linux",
      killGroup: (pid, sig) => calls.push([pid, sig]),
      taskkill: () => {
        throw new Error("not used");
      },
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([[42, "SIGKILL"]]);
  });

  it("killProcessTree returns false when the group is gone", () => {
    const ok = killProcessTree(42, "SIGTERM", {
      platform: "darwin",
      killGroup: () => {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      },
      taskkill: () => 0,
    });
    expect(ok).toBe(false);
  });

  it("killProcessTree uses taskkill on win32", () => {
    const pids: number[] = [];
    const deps = {
      platform: "win32" as const,
      killGroup: () => {
        throw new Error("not used");
      },
      taskkill: (pid: number) => {
        pids.push(pid);
        return pid === 7 ? 0 : 128;
      },
    };
    expect(killProcessTree(7, "SIGTERM", deps)).toBe(true);
    expect(killProcessTree(8, "SIGTERM", deps)).toBe(false);
    expect(pids).toEqual([7, 8]);
  });

  it.skipIf(process.platform !== "win32")(
    "killProcessTree ends a real child and grandchild on win32",
    async () => {
      const { spawn } = await import("node:child_process");
      const { isProcessAlive } = await import("../src/helpers.js");
      const script =
        "const {spawn}=require('node:child_process');" +
        "const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
        "console.log(g.pid);setInterval(()=>{},1000);";
      const child = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "pipe", "ignore"],
        ...processGroupSpawnOptions(),
      });
      const grandPid = await new Promise<number>((res) => {
        child.stdout?.once("data", (d) => res(Number(String(d).trim())));
      });
      expect(isProcessAlive(grandPid)).toBe(true);
      expect(killProcessTree(child.pid as number)).toBe(true);
      await new Promise((r) => setTimeout(r, 500));
      expect(isProcessAlive(child.pid as number)).toBe(false);
      expect(isProcessAlive(grandPid)).toBe(false);
    },
  );
});

describe("windowsEnvValue", () => {
  it("prefers the exact name, then matches case-insensitively", () => {
    expect(windowsEnvValue({ PATH: "a", Path: "b" }, "Path")).toBe("b");
    expect(windowsEnvValue({ Path: "b" }, "PATH")).toBe("b");
    expect(windowsEnvValue({}, "PATH")).toBeUndefined();
  });
});

describe("findOnWindowsPath", () => {
  const env = {
    Path: 'C:\\Windows\\System32;.;node_modules\\.bin;;"C:\\Program Files\\nodejs";C:\\npm',
    PATHEXT: ".EXE;.CMD",
  };

  it("searches absolute PATH entries in order with PATHEXT", () => {
    const exists = fakeFs(
      "C:\\npm\\claude.cmd",
      "C:\\Program Files\\nodejs\\claude.exe",
    );
    expect(findOnWindowsPath("claude", env, exists)).toBe(
      "C:\\Program Files\\nodejs\\claude.EXE",
    );
    // Within one directory the earlier PATHEXT extension wins.
    const sameDir = fakeFs("C:\\npm\\pi.cmd", "C:\\npm\\pi.exe");
    expect(findOnWindowsPath("pi", env, sameDir)).toBe("C:\\npm\\pi.EXE");
  });

  it("never searches the cwd or relative PATH entries", () => {
    const calls: string[] = [];
    const exists = (path: string) => {
      calls.push(path);
      return !/^C:\\(Windows|Program Files|npm)\\/i.test(path);
    };
    expect(findOnWindowsPath("git", env, exists)).toBeUndefined();
    expect(
      calls.every((p) => /^C:\\(Windows|Program Files|npm)\\/.test(p)),
    ).toBe(true);
    expect(findOnWindowsPath("git", {}, () => true)).toBeUndefined();
  });

  it("keeps an explicit extension and uses the default PATHEXT", () => {
    const exists = fakeFs("C:\\npm\\tool.exe", "C:\\npm\\codex.bat");
    expect(findOnWindowsPath("tool.exe", env, exists)).toBe(
      "C:\\npm\\tool.exe",
    );
    expect(findOnWindowsPath("codex", { PATH: "C:\\npm" }, exists)).toBe(
      "C:\\npm\\codex.BAT",
    );
  });

  it("appends PATHEXT to a dotted name that has no PATHEXT extension", () => {
    const exists = fakeFs("C:\\py\\python3.11.exe", "C:\\py\\run.ps1");
    const pyEnv = { PATH: "C:\\py" };
    expect(findOnWindowsPath("python3.11", pyEnv, exists)).toBe(
      "C:\\py\\python3.11.EXE",
    );
    // `.ps1` is not in PATHEXT: CreateProcess cannot run it, so no match.
    expect(findOnWindowsPath("run.ps1", pyEnv, exists)).toBeUndefined();
    expect(
      findOnWindowsPath("TOOL.Exe", env, fakeFs("C:\\npm\\TOOL.Exe")),
    ).toBe("C:\\npm\\TOOL.Exe");
  });

  it("checks an absolute path directly and rejects a relative one", () => {
    const exists = fakeFs("D:\\bin\\agent.cmd");
    expect(findOnWindowsPath("D:\\bin\\agent", env, exists)).toBe(
      "D:\\bin\\agent.CMD",
    );
    expect(findOnWindowsPath("D:\\bin\\none", env, exists)).toBeUndefined();
    expect(findOnWindowsPath("bin\\agent", env, () => true)).toBeUndefined();
  });
});

describe("taskkillPath", () => {
  it("uses SystemRoot, case-insensitively, and falls back to C:\\Windows", () => {
    expect(taskkillPath({ SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\taskkill.exe",
    );
    expect(taskkillPath({ SYSTEMROOT: "E:\\W" })).toBe(
      "E:\\W\\System32\\taskkill.exe",
    );
    expect(taskkillPath({})).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(taskkillPath()).toMatch(/\\System32\\taskkill\.exe$/);
  });
});

describe("windowsGitExecPath", () => {
  const env = { PATH: ".;C:\\Git\\cmd" };
  const gitExe = "C:\\Git\\cmd\\git.exe";

  it("runs git.exe by its absolute PATH location", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: "C:/Git/mingw64/libexec/git-core\n",
    }));
    expect(windowsGitExecPath(env, { exists: fakeFs(gitExe), run })).toBe(
      "C:/Git/mingw64/libexec/git-core",
    );
    expect(run).toHaveBeenCalledWith(gitExe, ["--exec-path"]);
  });

  it("does not run anything when git.exe is not on an absolute PATH entry", () => {
    const run = vi.fn();
    expect(
      windowsGitExecPath(env, { exists: fakeFs(".\\git.exe"), run }),
    ).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns undefined when git fails, prints nothing, or throws", () => {
    const exists = fakeFs(gitExe);
    const failing = [
      () => ({ status: 1, stdout: "x" }),
      () => ({ status: 0, stdout: "  \n" }),
      () => ({ status: 0, stdout: null }),
      () => {
        throw new Error("spawn EINVAL");
      },
    ];
    for (const run of failing) {
      expect(windowsGitExecPath(env, { exists, run })).toBeUndefined();
    }
  });
});

// win32 only (AC14): libuv searches the cwd before PATH for a bare name.
describe.runIf(process.platform === "win32")(
  "planted executables in the cwd (win32)",
  () => {
    it("shell discovery and tree kill never run a planted git.exe or taskkill.exe", async () => {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const marker = join(systemRoot, "System32", "hostname.exe");
      const dir = mkdtempSync(join(tmpdir(), "autoloop-plant-"));
      copyFileSync(marker, join(dir, "git.exe"));
      copyFileSync(marker, join(dir, "taskkill.exe"));
      const prev = process.cwd();
      process.chdir(dir);
      try {
        // Sanity: a bare-name spawn here runs the planted file (hostname.exe
        // rejects the argument and prints nothing), not git.
        const bare = spawnSync("git", ["--exec-path"], {
          encoding: "utf-8",
          windowsHide: true,
        });
        expect(bare.status).not.toBe(0);
        expect(bare.stdout).not.toMatch(/git-core/);

        const execPath = windowsGitExecPath(process.env);
        expect(execPath).toMatch(/git-core$/);
        resetPosixShellCache();
        const shell = resolvePosixShell();
        expect(shell.toLowerCase()).not.toContain(dir.toLowerCase());
        expect(shell.toLowerCase()).toMatch(/(sh|bash)\.exe$/);

        // The planted taskkill.exe would exit 1 and leave the child alive.
        const child = spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          { stdio: "ignore", ...processGroupSpawnOptions() },
        );
        const exited = new Promise((res) => child.once("exit", res));
        expect(killProcessTree(child.pid as number)).toBe(true);
        await exited;
      } finally {
        process.chdir(prev);
        resetPosixShellCache();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
