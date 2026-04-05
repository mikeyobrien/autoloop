import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readlinkSync, existsSync, statSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "../..");
const INSTALL_HOOKS = resolve(ROOT, "bin/install-hooks");
const HOOKS_SRC = resolve(ROOT, "hooks");

let tempDir: string;

function runInstaller(cwd: string): string {
  return execFileSync(INSTALL_HOOKS, [], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "hooks-test-"));
  // init a bare git repo structure
  execFileSync("git", ["init", tempDir], { timeout: 5_000 });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bin/install-hooks", () => {
  it("creates symlinks for pre-commit and pre-push", () => {
    // We need to point the script at the real repo hooks, but run in the temp git repo.
    // The script uses its own dirname to find the repo root, so we create a wrapper.
    const gitHooksDir = join(tempDir, ".git", "hooks");

    // Run the installer from the real repo root (it resolves REPO_ROOT from its own location)
    const out = runInstaller(ROOT);

    // Verify symlinks exist in the REAL repo .git/hooks (the installer always targets its own repo)
    const preCommitLink = resolve(ROOT, ".git/hooks/pre-commit");
    const prePushLink = resolve(ROOT, ".git/hooks/pre-push");

    expect(existsSync(preCommitLink)).toBe(true);
    expect(existsSync(prePushLink)).toBe(true);

    expect(readlinkSync(preCommitLink)).toBe(resolve(HOOKS_SRC, "pre-commit"));
    expect(readlinkSync(prePushLink)).toBe(resolve(HOOKS_SRC, "pre-push"));

    expect(out).toContain("installed");
  });

  it("is idempotent — re-running reports already installed", () => {
    // First run
    runInstaller(ROOT);
    // Second run
    const out = runInstaller(ROOT);
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
