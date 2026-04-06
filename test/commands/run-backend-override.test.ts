import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Verify applyGlobalBackendOverride behavior:
 * - cwd-based override applies even when user config exists
 * - deprecation warning only fires when both cwd override and user config exist
 */

// Mock harness.run to capture the options it receives
const runSpy = vi.fn();
vi.mock("../../src/harness/index.js", () => ({
  run: (...args: unknown[]) => runSpy(...args),
}));

// Mock chains to avoid side effects
vi.mock("../../src/chains.js", () => ({
  parseInlineChain: vi.fn(),
  validatePresetVocabulary: vi.fn(),
  runChain: vi.fn(),
  listKnownPresets: vi.fn(() => []),
}));

import { dispatchRun } from "../../src/commands/run.js";

const TMP_BASE = join(tmpdir(), "autoloop-override-test-" + process.pid);
const origCwd = process.cwd();
const origAutoloopConfig = process.env["AUTOLOOP_CONFIG"];

function tmpDir(name: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  mkdirSync(TMP_BASE, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  process.chdir(origCwd);
  if (origAutoloopConfig === undefined) delete process.env["AUTOLOOP_CONFIG"];
  else process.env["AUTOLOOP_CONFIG"] = origAutoloopConfig;
  rmSync(TMP_BASE, { recursive: true, force: true });
});

describe("applyGlobalBackendOverride", () => {
  it("applies cwd backend override when user config also exists", () => {
    // Set up cwd project with backend override
    const cwdDir = tmpDir("cwd-project");
    writeFileSync(
      join(cwdDir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "my-backend"\n',
    );

    // Set up a different target project dir
    const targetDir = tmpDir("target-project");
    writeFileSync(join(targetDir, "autoloops.toml"), "[event_loop]\nmax_iterations = 5\n");

    // Set up user config so hasUserConfig() returns true
    const userCfgPath = join(TMP_BASE, "user.toml");
    writeFileSync(userCfgPath, '[backend]\nkind = "command"\ncommand = "user-backend"\n');
    process.env["AUTOLOOP_CONFIG"] = userCfgPath;

    // Change cwd to the override project
    process.chdir(cwdDir);

    // Capture stderr for deprecation warning
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    dispatchRun([targetDir], [], targetDir, "autoloop");

    // harness.run should have been called with the cwd override applied
    expect(runSpy).toHaveBeenCalledTimes(1);
    const callArgs = runSpy.mock.calls[0];
    const opts = callArgs[3]; // fourth arg is the options object
    expect(opts.backendOverride).toMatchObject({ kind: "command", command: "my-backend" });

    // Deprecation warning should have fired
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );

    stderrSpy.mockRestore();
  });

  it("does not warn when cwd override applies but no user config", () => {
    const cwdDir = tmpDir("cwd-no-user");
    writeFileSync(
      join(cwdDir, "autoloops.toml"),
      '[backend]\nkind = "command"\ncommand = "cwd-backend"\n',
    );

    const targetDir = tmpDir("target-no-user");
    writeFileSync(join(targetDir, "autoloops.toml"), "[event_loop]\nmax_iterations = 2\n");

    // Point to nonexistent user config
    process.env["AUTOLOOP_CONFIG"] = join(TMP_BASE, "nonexistent-user.toml");

    process.chdir(cwdDir);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    dispatchRun([targetDir], [], targetDir, "autoloop");

    expect(runSpy).toHaveBeenCalledTimes(1);
    const opts = runSpy.mock.calls[0][3];
    expect(opts.backendOverride).toMatchObject({ kind: "command", command: "cwd-backend" });

    // No deprecation warning
    expect(stderrSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );

    stderrSpy.mockRestore();
  });
});
