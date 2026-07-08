import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const INSTALL_HOOKS = resolve(ROOT, "bin/install-hooks");
const HOOKS_SRC = resolve(ROOT, "hooks");

let tempDir: string;
let fixtureInstaller: string;
let fixtureHooksSrc: string;

function runInstaller(cwd: string): string {
  return execFileSync(fixtureInstaller, [], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "hooks-test-"));
  execFileSync("git", ["init", tempDir], { timeout: 5_000 });

  const fixtureBin = join(tempDir, "bin");
  mkdirSync(fixtureBin, { recursive: true });
  fixtureInstaller = join(fixtureBin, "install-hooks");
  copyFileSync(INSTALL_HOOKS, fixtureInstaller);
  chmodSync(fixtureInstaller, 0o755);

  fixtureHooksSrc = join(tempDir, "hooks");
  mkdirSync(fixtureHooksSrc, { recursive: true });
  for (const name of ["pre-commit", "pre-push"]) {
    const hookPath = join(fixtureHooksSrc, name);
    writeFileSync(hookPath, "#!/usr/bin/env bash\nexit 0\n", "utf-8");
    chmodSync(hookPath, 0o755);
  }
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bin/install-hooks", () => {
  it("creates symlinks for pre-commit and pre-push", () => {
    const out = runInstaller(tempDir);

    const preCommitLink = resolve(tempDir, ".git/hooks/pre-commit");
    const prePushLink = resolve(tempDir, ".git/hooks/pre-push");

    expect(existsSync(preCommitLink)).toBe(true);
    expect(existsSync(prePushLink)).toBe(true);

    expect(readlinkSync(preCommitLink)).toBe(
      resolve(fixtureHooksSrc, "pre-commit"),
    );
    expect(readlinkSync(prePushLink)).toBe(
      resolve(fixtureHooksSrc, "pre-push"),
    );

    expect(out).toContain("installed");
  });

  it("is idempotent — re-running reports already installed", () => {
    // First run
    runInstaller(tempDir);
    // Second run
    const out = runInstaller(tempDir);
    expect(out).toContain("already installed");
  });

  it("hooks/pre-commit and hooks/pre-push are executable", () => {
    const preCommit = resolve(HOOKS_SRC, "pre-commit");
    const prePush = resolve(HOOKS_SRC, "pre-push");

    // Check executable bit by trying to get help from bash
    // (the scripts will fail if npm run build fails, but they should at least start)
    expect(existsSync(preCommit)).toBe(true);
    expect(existsSync(prePush)).toBe(true);

    // Verify they have executable permissions
    const preCommitStat = statSync(preCommit);
    const prePushStat = statSync(prePush);

    // Check owner execute bit (0o100)
    expect(preCommitStat.mode & 0o111).toBeGreaterThan(0);
    expect(prePushStat.mode & 0o111).toBeGreaterThan(0);
  });
});
