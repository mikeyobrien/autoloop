import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeEvent } from "@mobrienv/autoloop-core";
import { describe, expect, it } from "vitest";
import {
  classifyStopReason,
  type FinishNotificationOptions,
  runFinishNotification,
} from "../../src/notify.js";

function makeProject(notifyToml: string): { dir: string; journal: string } {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-notify-test-"));
  writeFileSync(join(dir, "autoloops.toml"), notifyToml);
  return { dir, journal: join(dir, "journal.jsonl") };
}

function baseOpts(
  dir: string,
  journal: string,
  overrides: Partial<FinishNotificationOptions> = {},
): FinishNotificationOptions {
  return {
    projectDir: dir,
    journalFile: journal,
    runId: "run-notify-1",
    preset: "default",
    stopReason: "completed",
    iterations: 3,
    ...overrides,
  };
}

function journalEvents(journal: string) {
  if (!existsSync(journal)) return [];
  return readFileSync(journal, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => decodeEvent(line))
    .filter((event) => event !== null);
}

describe("classifyStopReason", () => {
  it("classifies completion variants as completed", () => {
    expect(classifyStopReason("completed")).toBe("completed");
    expect(classifyStopReason("completion_promise")).toBe("completed");
  });

  it("classifies backend failures as failed", () => {
    expect(classifyStopReason("backend_failed")).toBe("failed");
    expect(classifyStopReason("backend_timeout")).toBe("failed");
  });

  it("classifies a held UNKNOWN-verdict loop as failed so it surfaces", () => {
    expect(classifyStopReason("review_unknown")).toBe("failed");
  });

  it("classifies everything else as stopped", () => {
    expect(classifyStopReason("max_iterations")).toBe("stopped");
    expect(classifyStopReason("interrupted")).toBe("stopped");
    expect(classifyStopReason("cost_budget")).toBe("stopped");
  });
});

describe("runFinishNotification", () => {
  it("is disabled when notify.command is unset", () => {
    const { dir, journal } = makeProject('[backend]\ncommand = "echo"\n');
    const result = runFinishNotification(baseOpts(dir, journal));
    expect(result.status).toBe("disabled");
    expect(journalEvents(journal)).toHaveLength(0);
  });

  it("skips when the stop-reason class is not in notify.on", () => {
    const { dir, journal } = makeProject(
      `[notify]\ncommand = "touch ${join(tmpdir(), "should-not-exist")}"\non = "completed"\n`,
    );
    const result = runFinishNotification(
      baseOpts(dir, journal, { stopReason: "backend_failed" }),
    );
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("failed");
    expect(journalEvents(journal)).toHaveLength(0);
  });

  it("passes env vars and a JSON stdin payload to the command", () => {
    const { dir, journal } = makeProject("");
    const envOut = join(dir, "env.out");
    const stdinOut = join(dir, "stdin.out");
    writeFileSync(
      join(dir, "autoloops.toml"),
      `[notify]\ncommand = "env | grep ^AUTOLOOP_ > ${envOut}; cat > ${stdinOut}"\n`,
    );

    const result = runFinishNotification(
      baseOpts(dir, journal, { stopReason: "completed", iterations: 7 }),
    );
    expect(result.status).toBe("sent");

    const env = readFileSync(envOut, "utf-8");
    expect(env).toContain("AUTOLOOP_RUN_ID=run-notify-1");
    expect(env).toContain("AUTOLOOP_STOP_REASON=completed");
    expect(env).toContain("AUTOLOOP_ITERATIONS=7");
    expect(env).toContain("AUTOLOOP_PRESET=default");
    expect(env).toContain(`AUTOLOOP_PROJECT_DIR=${dir}`);

    const payload = JSON.parse(readFileSync(stdinOut, "utf-8"));
    expect(payload).toEqual({
      run_id: "run-notify-1",
      stop_reason: "completed",
      iterations: 7,
      preset: "default",
      project_dir: dir,
    });

    const events = journalEvents(journal);
    expect(events).toHaveLength(1);
    expect(events[0]?.topic).toBe("notify.sent");
    expect(events[0]?.run).toBe("run-notify-1");
    if (events[0]?.shape === "fields") {
      expect(events[0].fields.stop_reason).toBe("completed");
      expect(events[0].fields.command).toContain("env | grep ^AUTOLOOP_");
    } else {
      throw new Error("expected fields event");
    }
  });

  it("journals notify.failed on non-zero exit", () => {
    const { dir, journal } = makeProject(
      '[notify]\ncommand = "echo boom >&2; exit 3"\n',
    );
    const result = runFinishNotification(
      baseOpts(dir, journal, { stopReason: "backend_failed" }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("exit 3");

    const events = journalEvents(journal);
    expect(events).toHaveLength(1);
    expect(events[0]?.topic).toBe("notify.failed");
    if (events[0]?.shape === "fields") {
      expect(events[0].fields.command).toBe("echo boom >&2; exit 3");
      expect(events[0].fields.error).toContain("boom");
      expect(events[0].fields.error.length).toBeLessThanOrEqual(200);
    } else {
      throw new Error("expected fields event");
    }
  });

  it("enforces notify.timeout_ms and journals notify.failed", () => {
    const { dir, journal } = makeProject(
      '[notify]\ncommand = "sleep 5"\ntimeout_ms = 200\n',
    );
    const started = Date.now();
    const result = runFinishNotification(baseOpts(dir, journal));
    const elapsed = Date.now() - started;

    expect(result.status).toBe("failed");
    expect(elapsed).toBeLessThan(4000);

    const events = journalEvents(journal);
    expect(events).toHaveLength(1);
    expect(events[0]?.topic).toBe("notify.failed");
    if (events[0]?.shape === "fields") {
      expect(events[0].fields.error).toContain("ETIMEDOUT");
    } else {
      throw new Error("expected fields event");
    }
  });

  it("respects notify.on=stopped for non-terminal-class reasons", () => {
    const { dir, journal } = makeProject("");
    const marker = join(dir, "stopped.marker");
    writeFileSync(
      join(dir, "autoloops.toml"),
      `[notify]\ncommand = "touch ${marker}"\non = "stopped"\n`,
    );
    const result = runFinishNotification(
      baseOpts(dir, journal, { stopReason: "max_iterations" }),
    );
    expect(result.status).toBe("sent");
    expect(existsSync(marker)).toBe(true);
    expect(journalEvents(journal)[0]?.topic).toBe("notify.sent");
  });
});
