import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock harness.run to capture the options it receives, closing the CLI
// dispatch-level gap: prior tests stopped at buildLoopContext/resolvePresetSource,
// never exercising --preset-file / dispatchRun end to end.
const runSpy = vi.fn();
vi.mock("@mobrienv/autoloop-harness", () => ({
  run: (...args: unknown[]) => runSpy(...args),
}));

vi.mock("../../src/chains.js", () => ({
  parseInlineChain: vi.fn(),
  validatePresetVocabulary: vi.fn(),
  runChain: vi.fn(),
  listKnownPresets: vi.fn(() => []),
}));

import { dispatchRun, parseRunArgs } from "../../src/commands/run.js";

const SINGLE_FILE_PRESET = `
name = "adhoc"
completion = "task.complete"

[event_loop]
max_iterations = 7
completion_event = "task.complete"
completion_promise = "LOOP_COMPLETE"

[backend]
kind = "command"
command = "echo"
timeout_ms = 1000

[memory]
prompt_budget_chars = 4000

[[role]]
id = "builder"
prompt = "You are the builder. Do the work."
emits = ["task.complete"]

[handoff]
"loop.start" = ["builder"]
`;

let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "autoloop-preset-file-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("--preset-file flag parsing", () => {
  it("resolves an explicit single-file preset path", () => {
    const file = join(dir, "preset.toml");
    writeFileSync(file, SINGLE_FILE_PRESET);

    const options = parseRunArgs(
      ["--preset-file", file, "do", "the", "thing"],
      ".",
    );

    expect(options.usageError).toBe(false);
    expect(options.presetFile).toBe(file);
    expect(options.projectDir).toBe(dir);
    expect(options.presetExplicit).toBe(true);
    expect(options.prompt).toBe("do the thing");
  });

  it("errors when --preset-file has no argument", () => {
    const options = parseRunArgs(["--preset-file"], ".");
    expect(options.usageError).toBe(true);
  });

  it("errors on a nonexistent path", () => {
    const options = parseRunArgs(
      ["--preset-file", join(dir, "nope.toml"), "obj"],
      ".",
    );
    expect(options.usageError).toBe(true);
  });

  it("errors on a non-.toml path", () => {
    const notToml = join(dir, "preset.txt");
    writeFileSync(notToml, "hello");
    const options = parseRunArgs(["--preset-file", notToml, "obj"], ".");
    expect(options.usageError).toBe(true);
  });
});

describe("dispatchRun with --preset-file", () => {
  it("drives harness.run with the single-file preset's config", async () => {
    const file = join(dir, "preset.toml");
    writeFileSync(file, SINGLE_FILE_PRESET);

    await dispatchRun(
      ["--preset-file", file, "ship", "it"],
      [],
      ".",
      "autoloop",
    );

    expect(runSpy).toHaveBeenCalledTimes(1);
    const [projectDir, prompt, , opts] = runSpy.mock.calls[0];
    expect(projectDir).toBe(dir);
    expect(prompt).toBe("ship it");
    expect(opts.presetFile).toBe(file);
  });
});
