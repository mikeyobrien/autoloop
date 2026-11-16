import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildCommandInvocation,
  escalatesTimeoutKill,
  prepareShellScript,
  removeShellScript,
  runShellCommand,
  spawnShellCommand,
} from "@mobrienv/autoloop-backends/run-command";
import {
  PosixShellNotFoundError,
  resolvePosixShell,
  shellQuote,
} from "@mobrienv/autoloop-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mobrienv/autoloop-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mobrienv/autoloop-core")>();
  return { ...actual, resolvePosixShell: vi.fn(actual.resolvePosixShell) };
});

/** True while `pid` is a live (non-zombie) process. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  try {
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch {
    return false;
  }
}

describe("buildCommandInvocation", () => {
  it("builds arg-mode command with prompt as trailing argument", () => {
    const cmd = buildCommandInvocation(
      { command: "claude", args: ["--model", "opus"], promptMode: "arg" },
      "Fix the bug",
    );
    expect(cmd).toContain("'claude'");
    expect(cmd).toContain("'--model'");
    expect(cmd).toContain("'opus'");
    expect(cmd).toContain("'Fix the bug'");
    // arg mode: prompt is appended after command+args
    expect(cmd).not.toContain("|");
  });

  it("builds stdin-mode command with prompt piped via printf", () => {
    const cmd = buildCommandInvocation(
      { command: "claude", args: [], promptMode: "stdin" },
      "hello world",
    );
    expect(cmd).toContain("printf '%s'");
    expect(cmd).toContain("|");
    expect(cmd).toContain("'claude'");
  });

  it("shell-quotes prompt with special characters in arg mode", () => {
    const cmd = buildCommandInvocation(
      { command: "echo", args: [], promptMode: "arg" },
      'it\'s a "test" with $vars',
    );
    // The prompt should be quoted safely
    expect(cmd).toContain("echo");
    // Should not have unescaped double quotes or dollar signs that would expand
    expect(cmd).not.toMatch(/\$vars[^']/);
  });

  it("shell-quotes prompt with special characters in stdin mode", () => {
    const cmd = buildCommandInvocation(
      { command: "cat", args: [], promptMode: "stdin" },
      "line1\nline2",
    );
    expect(cmd).toContain("printf '%s'");
    expect(cmd).toContain("|");
  });

  it("handles empty args array", () => {
    const cmd = buildCommandInvocation(
      { command: "echo", args: [], promptMode: "arg" },
      "test",
    );
    expect(cmd).toContain("'echo'");
    expect(cmd).toContain("'test'");
  });

  it("handles multiple args correctly", () => {
    const cmd = buildCommandInvocation(
      { command: "node", args: ["-e", "console.log('hi')"], promptMode: "arg" },
      "prompt",
    );
    expect(cmd).toContain("'node'");
    expect(cmd).toContain("'-e'");
  });
});

describe("spawnShellCommand", () => {
  it("inherits caller environment by default", async () => {
    const result = await spawnShellCommand(
      "command",
      `printf '%s' "$NODE_OPTIONS"`,
      5000,
      undefined,
      {
        projectDir: "/tmp/project",
        env: { PATH: process.env.PATH, NODE_OPTIONS: "project-hook" },
      },
    );
    expect(result.output).toBe("project-hook");
  });

  it("sanitizes caller environment only under hardened policy", async () => {
    const result = await spawnShellCommand(
      "command",
      `printf '%s:%s' "\${NODE_OPTIONS-unset}" "\${LD_AUDIT-unset}"; bash -c 'if declare -F owned >/dev/null; then printf ":injected"; else printf ":unset"; fi'`,
      5000,
      undefined,
      {
        projectDir: "/tmp/project",
        environmentPolicy: "hardened",
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: "project-hook",
          LD_AUDIT: "/definitely-not-present-autoloop-audit.so",
          "BASH_FUNC_owned%%": "() { echo injected; }",
        },
      },
    );
    expect(result.output).toBe("unset:unset:unset");
  });

  it("resolves normally on a fast-exiting command", async () => {
    const result = await spawnShellCommand("command", "echo hello", 5000);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.errorCategory).toBe("none");
    expect(result.output).toContain("hello");
  });

  it("exposes a live pid before the promise settles", async () => {
    let capturedPid: number | undefined;
    const result = await spawnShellCommand(
      "command",
      "sleep 0.1; echo done",
      5000,
      (pid) => {
        capturedPid = pid;
      },
    );
    expect(capturedPid).toBeGreaterThan(0);
    expect(result.output).toContain("done");
  });

  it("reports a non-zero exit code without throwing", async () => {
    const result = await spawnShellCommand("command", "exit 7", 5000);
    expect(result.exitCode).toBe(7);
    expect(result.errorCategory).toBe("non_zero_exit");
    expect(result.timedOut).toBe(false);
  });

  it("times out a long-running command and marks it as timedOut", async () => {
    // win32: MSYS-forked utilities such as sleep are outside the Windows
    // process tree, so taskkill /T cannot reach them.
    const command =
      process.platform === "win32"
        ? `${shellQuote(process.execPath)} -e ${shellQuote("setTimeout(() => {}, 30000)")}`
        : "sleep 30";
    const result = await spawnShellCommand("command", command, 200);
    expect(result.timedOut).toBe(true);
    expect(result.errorCategory).toBe("timeout");
  }, 10000);

  it("timeout ends the backend child and its grandchild", async () => {
    const pidFile = join(
      tmpdir(),
      `autoloop-tree-pids-${process.pid}-${Date.now()}.json`,
    );
    // The backend child (node) starts a grandchild (node) that shares its
    // stdout, records both pids, and idles. The timeout must end both. The
    // pid file path goes through env: Git for Windows sh rewrites backslashes
    // in arguments to native programs.
    const childScript =
      `const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' });` +
      `require('fs').writeFileSync(process.env.AUTOLOOP_TEST_PID_FILE, JSON.stringify([process.pid, g.pid]));` +
      `setTimeout(() => {}, 30000);`;
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(childScript)}`;
    try {
      const result = await spawnShellCommand(
        "command",
        command,
        3000,
        undefined,
        { env: { ...process.env, AUTOLOOP_TEST_PID_FILE: pidFile } },
      );
      expect(result.timedOut).toBe(true);
      expect(result.errorCategory).toBe("timeout");
      const pids = JSON.parse(readFileSync(pidFile, "utf-8")) as number[];
      expect(pids).toHaveLength(2);
      const deadline = Date.now() + 5000;
      while (pids.some(isAlive) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(pids.filter(isAlive)).toEqual([]);
    } finally {
      rmSync(pidFile, { force: true });
    }
  }, 20000);

  it("reports a missing POSIX shell as a backend failure", async () => {
    vi.mocked(resolvePosixShell).mockImplementationOnce(() => {
      throw new PosixShellNotFoundError(["C:\\missing\\sh.exe"]);
    });
    const result = await spawnShellCommand("command", "echo hello", 5000);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.errorCategory).toBe("non_zero_exit");
    expect(result.output).toContain("command spawn error: ");
    expect(result.output).toContain("AUTOLOOP_SHELL");
    expect(result.output).toContain("C:\\missing\\sh.exe");
  });

  // win32: SIGUSR1 cannot be delivered and process groups do not exist.
  it.skipIf(process.platform === "win32")(
    "forwards SIGUSR1 to the child when signaled by pid",
    async () => {
      const markerFile = join(
        tmpdir(),
        `autoloop-usr1-marker-${process.pid}-${Date.now()}`,
      );
      let capturedPid: number | undefined;
      // A real Node child process, matching how an actual wrapped CLI tool
      // (e.g. this repo's mock-backend fixture) would cooperate with the
      // interrupt convention: register a SIGUSR1 handler via `process.on`,
      // which — unlike a shell's `trap` during a foreground blocking
      // command — libuv delivers and runs immediately, no `wait`/background
      // idiom required. Writes the marker file once the handler is installed
      // so the test can poll deterministically instead of guessing a delay.
      const script =
        `require('fs').writeFileSync(${JSON.stringify(markerFile)}, '');` +
        `process.on('SIGUSR1', () => { console.log('got-usr1'); process.exit(0); });` +
        `setTimeout(() => {}, 30000);`;
      const promise = spawnShellCommand(
        "command",
        `node -e ${JSON.stringify(script)}`,
        8000,
        (pid) => {
          capturedPid = pid;
        },
      );
      const deadline = Date.now() + 4000;
      while (!existsSync(markerFile) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(existsSync(markerFile)).toBe(true);
      expect(capturedPid).toBeGreaterThan(0);
      // `dash` (this repo's `/bin/sh`) forks rather than exec-replacing even
      // for a single tail-call command, so the wrapper `sh` process (whose pid
      // `onSpawn` reports) is not the real receiver — signal the whole
      // process group (`spawnShellCommand` spawns `detached: true`) so the
      // real `node` grandchild gets it directly, exactly like the harness's
      // own escalation path in index.ts signals a `command` iteration's group.
      process.kill(-(capturedPid as number), "SIGUSR1");
      const result = await promise;
      expect(result.output).toContain("got-usr1");
    },
    10000,
  );
});

describe("runShellCommand", () => {
  it("reports a missing POSIX shell as a backend failure", () => {
    vi.mocked(resolvePosixShell).mockImplementationOnce(() => {
      throw new PosixShellNotFoundError([]);
    });
    const result = runShellCommand("command", "echo hello", 5000);
    expect(result).toEqual({
      output: expect.stringContaining("command spawn error: "),
      exitCode: 1,
      timedOut: false,
      providerKind: "command",
      errorCategory: "non_zero_exit",
    });
    expect(result.output).toContain("Git for Windows");
  });

  it("reports a non-Error shell failure as a backend failure", () => {
    vi.mocked(resolvePosixShell).mockImplementationOnce(() => {
      throw "no shell";
    });
    const result = runShellCommand("command", "echo hello", 5000);
    expect(result.output).toBe("command spawn error: no shell");
    expect(result.errorCategory).toBe("non_zero_exit");
  });

  it("runs the command through the resolved POSIX shell", () => {
    const result = runShellCommand("command", "printf '%s' ok", 5000);
    expect(result.output).toBe("ok");
    expect(result.exitCode).toBe(0);
  });
});

/**
 * Text that breaks a long `sh.exe -c` argument on win32: double quotes,
 * single quotes, backslashes, and non-ASCII (`—`, `→`).
 */
function scriptPayload(minLength: number): string {
  const line = `He said "hi" — it's C:\\dir\\sub\\ → done; $HOME \`x\` 'q'\n`;
  return line.repeat(Math.ceil(minLength / line.length));
}

/**
 * Run `fn` with `os.tmpdir()` pointing at a fresh empty directory, so a test
 * can check that no temporary script file is left behind.
 */
async function withScratchTmpdir(
  fn: (dir: string) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-script-test-"));
  const saved = {
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  process.env.TMPDIR = dir;
  process.env.TEMP = dir;
  process.env.TMP = dir;
  try {
    await fn(dir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run `fn` with `process.platform` reported as win32 and the real resolved
 * shell, so the script-file path also runs on Linux.
 */
async function asWin32(fn: () => Promise<void> | void): Promise<void> {
  const shell = resolvePosixShell();
  const descriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  ) as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.mocked(resolvePosixShell).mockImplementation(() => shell);
  try {
    await fn();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    vi.mocked(resolvePosixShell).mockReset();
    const actual = await vi.importActual<
      typeof import("@mobrienv/autoloop-core")
    >("@mobrienv/autoloop-core");
    vi.mocked(resolvePosixShell).mockImplementation(actual.resolvePosixShell);
  }
}

describe("prepareShellScript", () => {
  it("passes the command as a -c argument on POSIX", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const script = prepareShellScript("echo hi", platform);
      expect(script).toEqual({ args: ["-c", "echo hi"] });
      removeShellScript(script);
    }
  });

  it("writes the command to a temporary UTF-8 file on win32", async () => {
    await withScratchTmpdir((dir) => {
      const command = `printf '%s' ${shellQuote(scriptPayload(100))}\n`;
      const script = prepareShellScript(command, "win32");
      expect(script.args).toEqual([script.scriptPath]);
      const scriptPath = script.scriptPath as string;
      expect(dirname(scriptPath)).toBe(dir);
      expect(readFileSync(scriptPath, "utf-8")).toBe(command);
      removeShellScript(script);
      expect(existsSync(scriptPath)).toBe(false);
      // A second remove (file already gone) does not throw.
      removeShellScript(script);
    });
  });

  it("gives each call its own file", async () => {
    await withScratchTmpdir(() => {
      const a = prepareShellScript("true", "win32");
      const b = prepareShellScript("true", "win32");
      expect(a.scriptPath).not.toBe(b.scriptPath);
      removeShellScript(a);
      removeShellScript(b);
    });
  });

  it("does not throw when the script file cannot be removed", async () => {
    await withScratchTmpdir((dir) => {
      // rmSync without `recursive` throws for a directory.
      expect(() =>
        removeShellScript({ args: [dir], scriptPath: dir }),
      ).not.toThrow();
      expect(existsSync(dir)).toBe(true);
    });
  });
});

describe("win32 script file", () => {
  it("spawnShellCommand runs the script from a file and removes it", async () => {
    await withScratchTmpdir(async (dir) => {
      await asWin32(async () => {
        const payload = scriptPayload(2000);
        const result = await spawnShellCommand(
          "command",
          `printf '%s|' "$0"; printf '%s' ${shellQuote(payload)}`,
          5000,
        );
        expect(result.errorCategory).toBe("none");
        const [scriptPath, output] = result.output.split("|");
        expect(scriptPath).toContain("autoloop-backend-script-");
        expect(output).toBe(payload);
        expect(readdirSync(dir)).toEqual([]);
      });
    });
  });

  it("runShellCommand runs the script from a file and removes it", async () => {
    await withScratchTmpdir(async (dir) => {
      await asWin32(() => {
        const payload = scriptPayload(2000);
        const result = runShellCommand(
          "command",
          `printf '%s|' "$0"; printf '%s' ${shellQuote(payload)}`,
          5000,
        );
        expect(result.errorCategory).toBe("none");
        const [scriptPath, output] = result.output.split("|");
        expect(scriptPath).toContain("autoloop-backend-script-");
        expect(output).toBe(payload);
        expect(readdirSync(dir)).toEqual([]);
      });
    });
  });

  it("removes the script file after a timeout", async () => {
    await withScratchTmpdir(async (dir) => {
      await asWin32(async () => {
        const spawned = await spawnShellCommand("command", "sleep 1", 200);
        expect(spawned.errorCategory).toBe("timeout");
        expect(readdirSync(dir)).toEqual([]);
        const ran = runShellCommand("command", "sleep 1", 200);
        expect(ran.errorCategory).toBe("timeout");
        expect(readdirSync(dir)).toEqual([]);
      });
    });
  }, 15000);

  it("removes the script file when the shell cannot start", async () => {
    await withScratchTmpdir(async (dir) => {
      await asWin32(async () => {
        const missing = join(dir, "missing-shell", "sh.exe");
        vi.mocked(resolvePosixShell).mockImplementation(() => missing);
        const spawned = await spawnShellCommand("command", "echo hi", 5000);
        expect(spawned.exitCode).toBe(1);
        expect(spawned.output).toContain("command spawn error: ");
        const ran = runShellCommand("command", "echo hi", 5000);
        expect(ran.exitCode).toBe(1);
        expect(ran.errorCategory).toBe("non_zero_exit");
        expect(readdirSync(dir)).toEqual([]);
      });
    });
  });

  it("removes the script file when spawn throws", async () => {
    await withScratchTmpdir(async (dir) => {
      await asWin32(async () => {
        // A NUL byte in the shell path makes spawn throw synchronously.
        vi.mocked(resolvePosixShell).mockImplementation(() => "sh\0bad");
        await expect(
          spawnShellCommand("command", "echo hi", 5000),
        ).rejects.toThrow();
        expect(readdirSync(dir)).toEqual([]);
        const ran = runShellCommand("command", "echo hi", 5000);
        expect(ran.errorCategory).toBe("non_zero_exit");
        expect(readdirSync(dir)).toEqual([]);
      });
    });
  });

  it("reports an unwritable temp directory as a backend failure", async () => {
    await withScratchTmpdir(async (dir) => {
      const missingDir = join(dir, "missing");
      process.env.TMPDIR = missingDir;
      process.env.TEMP = missingDir;
      process.env.TMP = missingDir;
      await asWin32(async () => {
        const spawned = await spawnShellCommand("command", "echo hi", 5000);
        expect(spawned.output).toContain("command spawn error: ");
        expect(spawned.errorCategory).toBe("non_zero_exit");
        const ran = runShellCommand("command", "echo hi", 5000);
        expect(ran.output).toContain("command spawn error: ");
        expect(ran.exitCode).toBe(1);
      });
    });
  });

  // win32 only: these lengths break `sh.exe -c <script>` (MSYS parser at
  // ~20,000 characters, Windows command-line limit at 32,767).
  for (const minLength of [20_000, 34_000]) {
    it.runIf(process.platform === "win32")(
      `runs a ${minLength}-character script with quotes and non-ASCII text`,
      async () => {
        const payload = scriptPayload(minLength);
        const command = `printf '%s' ${shellQuote(payload)}`;
        expect(command.length).toBeGreaterThan(minLength);
        const spawned = await spawnShellCommand("command", command, 20000);
        expect(spawned.errorCategory).toBe("none");
        expect(spawned.output).toBe(payload);
        const ran = runShellCommand("command", command, 20000);
        expect(ran.errorCategory).toBe("none");
        expect(ran.output).toBe(payload);
      },
      30000,
    );
  }
});

describe("escalatesTimeoutKill", () => {
  it("always escalates SIGTERM to SIGKILL on POSIX", () => {
    for (const settled of [false, true]) {
      expect(escalatesTimeoutKill(settled, "linux")).toBe(true);
      expect(escalatesTimeoutKill(settled, "darwin")).toBe(true);
    }
  });

  it("retries taskkill on win32 only while the child has not settled", () => {
    expect(escalatesTimeoutKill(false, "win32")).toBe(true);
    expect(escalatesTimeoutKill(true, "win32")).toBe(false);
  });
});
