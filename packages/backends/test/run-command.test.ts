import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCommandInvocation,
  spawnShellCommand,
} from "@mobrienv/autoloop-backends/run-command";
import { describe, expect, it } from "vitest";

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
    const result = await spawnShellCommand("command", "sleep 30", 200);
    expect(result.timedOut).toBe(true);
    expect(result.errorCategory).toBe("timeout");
  }, 10000);

  it("forwards SIGUSR1 to the child when signaled by pid", async () => {
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
  }, 10000);
});
