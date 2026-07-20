import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const DEV = resolve(ROOT, "bin/dev");

function run(args: string[], timeoutMs = 30_000): string {
  return execFileSync(DEV, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...process.env },
  });
}

function runExpectFail(args: string[]): { stderr: string; code: number } {
  try {
    execFileSync(DEV, args, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...process.env },
    });
    throw new Error("expected non-zero exit");
  } catch (err: unknown) {
    const execError = err as { stderr?: string | Buffer; status?: number };
    return {
      stderr: String(execError.stderr ?? ""),
      code: execError.status ?? 1,
    };
  }
}

describe("bin/dev", () => {
  it("prints help with no arguments", () => {
    const out = run([]);
    expect(out).toContain("Usage: bin/dev");
    expect(out).toContain("build");
    expect(out).toContain("test");
    expect(out).toContain("hooks");
    expect(out).toContain("run");
  });

  it("prints help with --help", () => {
    const out = run(["--help"]);
    expect(out).toContain("Usage: bin/dev");
  });

  it("prints help with -h", () => {
    const out = run(["-h"]);
    expect(out).toContain("Usage: bin/dev");
  });

  it("exits non-zero for unknown subcommand", () => {
    const { stderr, code } = runExpectFail(["bogus"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown command");
    expect(stderr).toContain("bogus");
  });

  it("build subcommand runs tsc successfully", () => {
    // Full-monorepo tsc can exceed 30s under whole-suite load; the spawn
    // timeout must match the test's own 60s budget.
    const _out = run(["build"], 60_000);
    // tsc produces no output on success, but npm logs the script name
    // Just verify it exits 0 (no throw)
    expect(true).toBe(true);
  }, 60_000);

  it("test subcommand delegates to vitest", () => {
    // A parent `vitest --coverage` exports coverage state to subprocesses. Give
    // this nested Vitest invocation its own report directory so its startup
    // cleanup cannot remove the parent's in-flight coverage/.tmp files.
    const coverageDir = mkdtempSync(join(tmpdir(), "autoloop-dev-coverage-"));
    try {
      const out = run(
        [
          "test",
          "--coverage.reportsDirectory",
          coverageDir,
          "test/agent-map.test.ts",
        ],
        60_000,
      );
      expect(out).toContain("agent-map");
    } finally {
      rmSync(coverageDir, { recursive: true, force: true });
    }
  }, 60_000);
});
