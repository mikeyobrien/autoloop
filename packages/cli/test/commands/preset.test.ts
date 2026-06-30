import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchPreset } from "../../src/commands/preset.js";

const VALID_PRESET = `
name = "myreview"
completion = "task.complete"

[event_loop]
max_iterations = 5
completion_event = "task.complete"
completion_promise = "DONE"

[backend]
kind = "command"
command = "echo"

[[role]]
id = "builder"
prompt = "build it"
emits = ["task.complete"]

[handoff]
"loop.start" = ["builder"]
`;

let work: string;
let prevXdg: string | undefined;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "autoloop-preset-test-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(work, "config");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(work, { recursive: true, force: true });
});

function captureOut(fn: () => void): string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) =>
    lines.push(a.join(" ")),
  );
  fn();
  return lines.join("\n");
}

function captureErr(fn: () => void): string {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    lines.push(String(s));
    return true;
  });
  fn();
  return lines.join("\n");
}

describe("dispatchPreset promote", () => {
  it("promotes a valid single-file preset into the user presets dir", () => {
    const src = join(work, "good.toml");
    writeFileSync(src, VALID_PRESET);
    const out = captureOut(() => dispatchPreset(["promote", src, "myreview"]));
    expect(out).toContain("promoted");
    expect(
      existsSync(
        join(
          process.env.XDG_CONFIG_HOME ?? "",
          "autoloop",
          "presets",
          "myreview.toml",
        ),
      ),
    ).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("reports a clean one-line error (no stack trace) on malformed TOML", () => {
    const src = join(work, "bad.toml");
    writeFileSync(src, "this is = = not valid toml\n[[[\n");
    const err = captureErr(() => dispatchPreset(["promote", src, "foo"]));
    expect(err).toContain("invalid TOML in");
    expect(err).not.toContain("at Object.");
    expect(err).not.toContain("TomlError");
    expect(process.exitCode).toBe(1);
  });

  it("refuses to clobber an existing preset", () => {
    const src = join(work, "good.toml");
    writeFileSync(src, VALID_PRESET);
    dispatchPreset(["promote", src, "myreview"]);
    process.exitCode = 0;
    const err = captureErr(() => dispatchPreset(["promote", src, "myreview"]));
    expect(err).toContain("already exists");
    expect(process.exitCode).toBe(1);
  });

  it("errors when the source file is missing", () => {
    const err = captureErr(() =>
      dispatchPreset(["promote", join(work, "nope.toml"), "x"]),
    );
    expect(err).toContain("source preset not found");
    expect(process.exitCode).toBe(1);
  });

  it("errors on an unknown subcommand", () => {
    const err = captureErr(() => dispatchPreset(["bogus"]));
    expect(err).toContain("unknown preset subcommand");
    expect(process.exitCode).toBe(1);
  });
});
