import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the ESM `require("node:fs")` bug in looksLikeProjectDir.
 *
 * The package is built as ESM, where `require` is undefined; the previous
 * `require("node:fs").statSync(...)` threw on every call, the catch swallowed
 * it, and looksLikeProjectDir always returned false. That made `--chain` ignore
 * an explicit project dir (or cwd) containing autoloops.toml and always fall
 * back to the bundled-presets dir, so chain state misrooted into the install
 * instead of the user's repo.
 *
 * Here we pass a real temp dir that contains autoloops.toml as the chain
 * project-dir and assert it is forwarded to chains.runChain as projectDir.
 * Before the fix this assertion fails (projectDir is the bundle root).
 */

vi.mock("../../src/chains.js", () => ({
  parseInlineChain: vi.fn((_csv: string, _dir: string) => ({
    name: "inline",
    steps: [{ name: "autocode" }, { name: "autoqa" }],
  })),
  validatePresetVocabulary: vi.fn(() => ({ ok: true })),
  runChain: vi.fn(() => ({ completed: [], outcome: "ok" })),
  listKnownPresets: vi.fn(() => ["autocode", "autoqa"]),
}));

vi.mock("@mobrienv/autoloop-harness", () => ({
  run: vi.fn(),
}));

import * as chains from "../../src/chains.js";
import { dispatchRun } from "../../src/commands/run.js";

describe("chain project-dir resolution", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = mkdtempSync(join(tmpdir(), "autoloop-chain-projectdir-"));
    writeFileSync(
      join(projectDir, "autoloops.toml"),
      'backend.command = "claude"\n',
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("roots the chain at a project dir containing autoloops.toml", () => {
    dispatchRun(
      ["--chain", "autocode,autoqa", projectDir],
      [],
      ".",
      "autoloop",
    );

    expect(chains.runChain).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(chains.runChain).mock.calls[0];
    // runChain(chainSpec, projectDir, selfCommand, runOptions)
    expect(callArgs[1]).toBe(projectDir);
  });
});
