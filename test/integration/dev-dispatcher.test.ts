import { describe, it, expect } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const DEV = resolve(ROOT, "bin/dev");

function run(args: string[]): string {
  return execFileSync(DEV, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 30_000,
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
  } catch (err: any) {
    return { stderr: err.stderr ?? "", code: err.status ?? 1 };
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
    const out = run(["build"]);
    // tsc produces no output on success, but npm logs the script name
    // Just verify it exits 0 (no throw)
    expect(true).toBe(true);
  }, 60_000);

  it("test subcommand delegates to vitest", () => {
    // Run a small, fast unit test to verify delegation without self-recursion
    const out = run(["test", "test/json.test.ts"]);
    expect(out).toContain("json");
  }, 60_000);
});
