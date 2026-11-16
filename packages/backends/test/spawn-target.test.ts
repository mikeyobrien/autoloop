import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeCmdShimArgument,
  resolveSpawnTarget,
} from "../src/spawn-target.js";

function fakeFs(...files: string[]): (path: string) => boolean {
  const lower = new Set(files.map((f) => f.toLowerCase()));
  return (path) => lower.has(path.toLowerCase());
}

const WIN_ENV = {
  Path: 'C:\\Windows\\System32;"C:\\Program Files\\nodejs";;C:\\npm',
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};

describe("resolveSpawnTarget", () => {
  it("spawns the command unchanged off win32", () => {
    expect(
      resolveSpawnTarget("claude", ["-p"], {
        env: WIN_ENV,
        cwd: "/repo",
        platform: "linux",
        exists: () => true,
      }),
    ).toEqual({ command: "claude", args: ["-p"] });
  });

  it("runs a PATH .cmd shim through cmd.exe with escaped arguments", () => {
    const target = resolveSpawnTarget("npx", ["-y", "@scope/acp agent"], {
      env: WIN_ENV,
      cwd: "C:\\repo",
      platform: "win32",
      exists: fakeFs("C:\\Program Files\\nodejs\\npx.cmd"),
    });
    expect(target).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '"C:\\Program^ Files\\nodejs\\npx.CMD ^^^"-y^^^" ^^^"@scope/acp^^^ agent^^^""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it("prefers the earlier PATHEXT extension in the same directory", () => {
    const target = resolveSpawnTarget("pi", [], {
      env: WIN_ENV,
      cwd: "C:\\repo",
      platform: "win32",
      exists: fakeFs("C:\\npm\\pi.cmd", "C:\\npm\\pi.exe"),
    });
    // .EXE precedes .CMD in PATHEXT, so the real executable wins, spawned
    // by its absolute path (a bare name would search the cwd first).
    expect(target).toEqual({ command: "C:\\npm\\pi.EXE", args: [] });
  });

  it("spawns a PATH .exe or .com by its absolute path", () => {
    const options = {
      env: WIN_ENV,
      cwd: "C:\\repo",
      platform: "win32" as const,
      exists: fakeFs("C:\\npm\\codex.exe", "C:\\npm\\tool.com"),
    };
    expect(resolveSpawnTarget("codex", ["exec"], options)).toEqual({
      command: "C:\\npm\\codex.EXE",
      args: ["exec"],
    });
    expect(resolveSpawnTarget("tool.com", [], options)).toEqual({
      command: "C:\\npm\\tool.com",
      args: [],
    });
  });

  it("spawns unchanged when the hit is neither an executable nor a batch file", () => {
    expect(
      resolveSpawnTarget("agent.ps1", ["x"], {
        env: WIN_ENV,
        cwd: "C:\\repo",
        platform: "win32",
        exists: fakeFs("C:\\npm\\agent.ps1"),
      }),
    ).toEqual({ command: "agent.ps1", args: ["x"] });
  });

  it("spawns unchanged when nothing on PATH matches", () => {
    expect(
      resolveSpawnTarget("kiro-cli", ["acp"], {
        env: WIN_ENV,
        cwd: "C:\\repo",
        platform: "win32",
        exists: () => false,
      }),
    ).toEqual({ command: "kiro-cli", args: ["acp"] });
  });

  it("resolves a relative command path against cwd and keeps an explicit extension", () => {
    const target = resolveSpawnTarget("bin\\agent.bat", [], {
      env: {},
      cwd: "C:\\repo",
      platform: "win32",
      exists: fakeFs("C:\\repo\\bin\\agent.bat"),
    });
    expect(target.args).toEqual([
      "/d",
      "/s",
      "/c",
      '"C:\\repo\\bin\\agent.bat"',
    ]);
  });

  it("uses the default PATHEXT and falls back from ComSpec to SystemRoot", () => {
    const target = resolveSpawnTarget("codex", [], {
      env: { PATH: "C:\\npm", SystemRoot: "C:\\Windows" },
      cwd: "C:\\repo",
      platform: "win32",
      exists: fakeFs("C:\\npm\\codex.cmd"),
    });
    expect(target.command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("falls back to C:\\Windows\\System32\\cmd.exe without ComSpec or SystemRoot", () => {
    const target = resolveSpawnTarget("codex", [], {
      env: { PATH: "C:\\npm" },
      cwd: "C:\\repo",
      platform: "win32",
      exists: fakeFs("C:\\npm\\codex.cmd"),
    });
    // Never a bare cmd.exe: Windows would search the cwd first.
    expect(target.command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("does not search the current directory or an unset PATH", () => {
    expect(
      resolveSpawnTarget("claude", [], {
        env: {},
        cwd: "C:\\repo",
        platform: "win32",
        exists: fakeFs("C:\\repo\\claude.cmd"),
      }),
    ).toEqual({ command: "claude", args: [] });
  });

  it("skips relative PATH entries", () => {
    const target = resolveSpawnTarget("claude", [], {
      env: { PATH: ".;node_modules\\.bin;C:\\npm" },
      cwd: "C:\\repo",
      platform: "win32",
      exists: (path) => /\\claude\.cmd$/i.test(path),
    });
    // Only the absolute entry is searched, whatever the harness's cwd is.
    expect(target.args).toEqual(["/d", "/s", "/c", '"C:\\npm\\claude.CMD"']);
  });

  // win32 only: a planted executable in the cwd must not run (AC14).
  it.runIf(process.platform === "win32")(
    "runs the PATH .exe, not a same-named .exe planted in the cwd",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "autoloop-plant-"));
      try {
        const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
        copyFileSync(
          join(systemRoot, "System32", "hostname.exe"),
          join(dir, "git.exe"),
        );
        const target = resolveSpawnTarget("git", ["--version"], {
          env: process.env,
          cwd: dir,
        });
        expect(target.command.toLowerCase()).toMatch(/\\git\.exe$/);
        expect(target.command.toLowerCase()).not.toContain(dir.toLowerCase());
        const result = spawnSync(target.command, target.args, {
          cwd: dir,
          encoding: "utf-8",
          windowsHide: true,
        });
        expect(result.stdout).toMatch(/^git version/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  // win32 only: runs a real cmd shim through cmd.exe.
  it.runIf(process.platform === "win32")(
    "passes arguments verbatim through a real npm-style cmd shim",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "autoloop shim (x86) "));
      try {
        writeFileSync(
          join(dir, "echo-args.js"),
          "console.log(JSON.stringify(process.argv.slice(2)));\n",
        );
        writeFileSync(
          join(dir, "echo-args.cmd"),
          `@ECHO off\r\n"${process.execPath}" "%~dp0\\echo-args.js" %*\r\n`,
        );
        const args = [
          "--mode",
          "a b",
          'q"uote',
          "amp&calc",
          "pipe|x",
          "%PATH%",
          "!x!",
          "back\\slash\\",
          'a\\\\"b',
          "end\\\\",
          "caret^",
          "paren(1)",
          "star*",
          "",
          "it's",
          "<gt>",
        ];
        const target = resolveSpawnTarget("echo-args", args, {
          env: { ...process.env, PATH: dir },
          cwd: dir,
        });
        expect(target.windowsVerbatimArguments).toBe(true);
        const result = spawnSync(target.command, target.args, {
          encoding: "utf-8",
          windowsVerbatimArguments: true,
        });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(args);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("escapeCmdShimArgument", () => {
  it("quotes and double-escapes cmd metacharacters", () => {
    expect(escapeCmdShimArgument("a&b")).toBe('^^^"a^^^&b^^^"');
  });

  it("doubles backslashes before a quote and at the end", () => {
    expect(escapeCmdShimArgument('x\\"y\\')).toBe('^^^"x\\\\\\^^^"y\\\\^^^"');
  });

  it("doubles every backslash in a run before a quote and at the end", () => {
    // 2 backslashes + quote -> 5 backslashes + quote (2n+1).
    expect(escapeCmdShimArgument('a\\\\"b')).toBe(
      `^^^"a${"\\".repeat(5)}^^^"b^^^"`,
    );
    // 2 trailing backslashes -> 4, so the closing quote stays a quote.
    expect(escapeCmdShimArgument("end\\\\")).toBe(
      `^^^"end${"\\".repeat(4)}^^^"`,
    );
  });
});
