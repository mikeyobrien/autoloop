import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/backend");
const ENTRY = resolve(ROOT, "dist/testing/mock-backend.js");

interface Fixture {
  output: string;
  exit_code: number;
  delay_ms: number;
  emit_event?: string;
  emit_payload?: string;
}

const FIXTURE_FILES = [
  "complete-success.json",
  "invalid-event.json",
  "no-completion.json",
  "timeout.json",
  "non-zero-exit.json",
];

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    execFileSync("node", [resolve(ROOT, "node_modules/typescript/bin/tsc")], {
      cwd: ROOT,
      timeout: 30_000,
    });
  }
});

describe("backend fixture files", () => {
  for (const file of FIXTURE_FILES) {
    const path = resolve(FIXTURES_DIR, file);

    it(`${file} exists`, () => {
      expect(existsSync(path)).toBe(true);
    });

    it(`${file} is valid JSON with required fields`, () => {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as Fixture;
      expect(typeof parsed.output).toBe("string");
      expect(typeof parsed.exit_code).toBe("number");
    });
  }

  it("complete-success emits task.complete", () => {
    const parsed = loadFixture("complete-success.json");
    expect(parsed.emit_event).toBe("task.complete");
    expect(parsed.exit_code).toBe(0);
  });

  it("complete-success includes LOOP_COMPLETE promise", () => {
    const parsed = loadFixture("complete-success.json");
    expect(parsed.output).toContain("LOOP_COMPLETE");
  });

  it("invalid-event emits a non-standard event", () => {
    const parsed = loadFixture("invalid-event.json");
    expect(parsed.emit_event).toBe("bogus.not.allowed");
    expect(parsed.exit_code).toBe(0);
  });

  it("no-completion has no emit_event", () => {
    const parsed = loadFixture("no-completion.json");
    expect(parsed.emit_event).toBeUndefined();
  });

  it("timeout has delay_ms > 0", () => {
    const parsed = loadFixture("timeout.json");
    expect(parsed.delay_ms).toBeGreaterThan(0);
  });

  it("non-zero-exit has exit_code != 0", () => {
    const parsed = loadFixture("non-zero-exit.json");
    expect(parsed.exit_code).not.toBe(0);
  });
});

describe("mock-backend executable behavior", () => {
  it("runs with fixture path argument and prints scripted output", () => {
    const fixture = resolve(FIXTURES_DIR, "no-completion.json");
    const out = execFileSync("node", [ENTRY, fixture], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(out).toContain("Some work was done but no completion signal.");
  });

  it("runs with MOCK_FIXTURE_PATH env var and prints scripted output", () => {
    const fixture = resolve(FIXTURES_DIR, "complete-success.json");
    const out = execFileSync("node", [ENTRY], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
      env: { ...process.env, MOCK_FIXTURE_PATH: fixture },
    });
    expect(out).toContain("Task completed successfully.");
    expect(out).toContain("LOOP_COMPLETE");
  });

  it("exits 2 when no fixture path is provided", () => {
    const res = spawnSync("node", [ENTRY], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(2);
    expect((res.stderr || "") + (res.stdout || "")).toContain("fixture path missing");
  });

  it("propagates non-zero fixture exit codes", () => {
    const fixture = resolve(FIXTURES_DIR, "non-zero-exit.json");
    const res = spawnSync("node", [ENTRY, fixture], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Backend process failed with an error.");
  });
});

function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), "utf-8")) as Fixture;
}
