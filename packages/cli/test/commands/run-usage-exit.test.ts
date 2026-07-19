import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const ENTRY = resolve(ROOT, "dist/main.js");

function cli(...args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [ENTRY, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 10_000,
    env: { ...process.env, AUTOLOOP_PROJECT_DIR: undefined },
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    const repoRoot = resolve(ROOT, "..", "..");
    execFileSync(
      "node",
      [resolve(repoRoot, "node_modules/typescript/bin/tsc")],
      {
        cwd: ROOT,
        timeout: 30_000,
      },
    );
  }
});

describe("run usage errors", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "autoloop-run-usage-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits with the usage code for an unknown preset", () => {
    const result = cli("run", "does-not-exist");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("preset");
  });

  it("exits with the usage code when --max-iterations has no value", () => {
    const result = cli("run", "autocode", "--max-iterations");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing iteration count");
    expect(result.stdout).toBe("");
  });

  it("writes a terminal error event when --events was parsed", () => {
    const eventsPath = join(tempDir, "events.ndjson");
    const result = cli("run", "bad-preset-name", "--events", eventsPath);

    expect(result.status).toBe(1);
    expect(existsSync(eventsPath)).toBe(true);

    const events: unknown[] = readFileSync(eventsPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "loop.finish",
        stopReason: "error",
      }),
    );
  });

  it("writes a terminal error event for an invalid inline chain", () => {
    const eventsPath = join(tempDir, "chain-events.ndjson");
    const result = cli(
      "run",
      "--chain",
      "nosuch,alsonot",
      "--events",
      eventsPath,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid inline chain");
    expect(existsSync(eventsPath)).toBe(true);

    const events: unknown[] = readFileSync(eventsPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "loop.finish",
        stopReason: "error",
      }),
    );
  });

  it("exits with the usage code for an unknown chain", () => {
    const result = cli("chain", "run", "nosuchchain-ga3", tempDir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("not found in chains.toml");
  });

  it("exits with the usage code for an unknown chain subcommand", () => {
    const result = cli("chain", "frobnicate-ga3");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown chain subcommand");
  });

  it("exits with the usage code for an unknown runs subcommand", () => {
    const result = cli("runs", "frobnicate-ga3");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unknown runs subcommand");
  });

  it("prints the version and exits successfully", () => {
    const result = cli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
