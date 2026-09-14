#!/usr/bin/env node

/**
 * Deterministic mock backend for autoloop integration tests.
 *
 * Usage:
 *   node dist/testing/mock-backend.js [fixture-path] [prompt]
 *
 * Reads MOCK_FIXTURE_PATH to find a JSON fixture describing the output,
 * or accepts a fixture path as the first positional argument.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

interface Fixture {
  output: string;
  exit_code: number;
  delay_ms: number;
  emit_event?: string;
  emit_payload?: string;
  /**
   * Cost-telemetry test fixture: when set, written verbatim (as JSON) to
   * $AUTOLOOP_USAGE_FILE before the process exits — exercises the
   * `usage_from = "file"` convention documented for the `command` backend.
   */
  usage?: Record<string, number>;
  /**
   * When true, traps SIGUSR1 and exits 130 instead of the default action —
   * exercises the `command` backend's live-control interrupt path
   * end-to-end against a real cooperating child process.
   */
  trap_usr1?: boolean;
  /**
   * When true, the fixture's event is emitted at most once per run state
   * dir: a `<stateDir>/wait-request-once` sentinel is written on the first
   * emission and suppresses later emissions. Lets a single fixture drive
   * both the parking iteration and the auto-resumed completion iteration
   * without an endless park/re-park cycle.
   */
  emit_once?: boolean;
}

function fixturePathFromArgs(): string {
  return process.argv[2] ?? "";
}

function loadFixture(): Fixture {
  const fixturePath = process.env.MOCK_FIXTURE_PATH || fixturePathFromArgs();
  if (!fixturePath) {
    process.stderr.write(
      "mock-backend: fixture path missing (set MOCK_FIXTURE_PATH or pass a fixture path argument)\n",
    );
    process.exit(2);
  }

  try {
    const raw = readFileSync(fixturePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Fixture>;
    return {
      output: parsed.output ?? "",
      exit_code: parsed.exit_code ?? 0,
      delay_ms: parsed.delay_ms ?? 0,
      emit_event: parsed.emit_event,
      emit_payload: parsed.emit_payload,
      usage: parsed.usage,
      trap_usr1: parsed.trap_usr1 ?? false,
      emit_once: parsed.emit_once ?? false,
    };
  } catch (err) {
    process.stderr.write(`mock-backend: failed to load fixture: ${err}\n`);
    process.exit(2);
  }
}

function emitEvent(event: string, payload: string): void {
  const require = createRequire(import.meta.url);
  const mainEntry = require.resolve("@mobrienv/autoloop-cli");

  try {
    execFileSync(process.execPath, [mainEntry, "emit", event, payload], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
  } catch (err) {
    process.stderr.write(`mock-backend: emit failed: ${err}\n`);
  }
}

/**
 * One-shot gate for `emit_once` fixtures: the sentinel lives under the run
 * state dir (exported to the backend by the harness), so the same fixture
 * can park once and let the auto-resumed iteration complete instead of
 * parking forever.
 */
function shouldEmit(fixture: Fixture): boolean {
  if (!fixture.emit_once) return true;
  const sentinel = process.env.AUTOLOOP_STATE_DIR
    ? join(process.env.AUTOLOOP_STATE_DIR, "wait-request-once")
    : "wait-request-once";
  if (existsSync(sentinel)) return false;
  writeFileSync(sentinel, "");
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const fixture = loadFixture();

  if (fixture.trap_usr1) {
    process.on("SIGUSR1", () => {
      process.stdout.write("mock-backend: interrupted by SIGUSR1\n");
      process.exit(130);
    });
  }

  if (fixture.delay_ms > 0) {
    await sleep(fixture.delay_ms);
  }

  if (fixture.emit_event && shouldEmit(fixture)) {
    emitEvent(fixture.emit_event, fixture.emit_payload ?? "");
  }

  if (fixture.output) {
    process.stdout.write(fixture.output);
  }

  if (fixture.usage) {
    const usageFile = process.env.AUTOLOOP_USAGE_FILE;
    if (usageFile) {
      writeFileSync(usageFile, JSON.stringify(fixture.usage));
    }
  }

  process.exitCode = fixture.exit_code;
}

main().catch((err) => {
  process.stderr.write(`mock-backend: unexpected error: ${err}\n`);
  process.exitCode = 2;
});
