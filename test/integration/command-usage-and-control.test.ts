import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  pathExists,
  readText,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

/**
 * End-to-end coverage for issue #34's command-backend telemetry + live
 * control parity: `usage_from = "file"` cost reporting, `max_cost_usd`
 * enforcement fed by it, and the `commandControlAdapter`'s interrupt signal
 * against a real cooperating child process.
 */

function writeUsageFixture(dir: string, name: string, body: object): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body), "utf-8");
  return path;
}

function enableUsageFrom(projectDir: string): void {
  const configPath = join(projectDir, "autoloops.toml");
  const config = readFileSync(configPath, "utf-8");
  writeFileSync(
    configPath,
    `${config}\nbackend.usage_from = "file"\n`,
    "utf-8",
  );
}

describe("integration: command backend cost telemetry", () => {
  it("reports cost_usd from a usage_from=file fixture and journals backend.usage", () => {
    const project = makeTempProject("command-usage");
    enableUsageFrom(project);
    const fixture = writeUsageFixture(project, "usage-fixture.json", {
      output: "did the work. LOOP_COMPLETE",
      exit_code: 0,
      delay_ms: 0,
      usage: {
        cost_usd: 0.0123,
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 5,
        cache_write_tokens: 1,
      },
    });

    const res = runCli(["run", project, "usage telemetry"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "backend.usage"');
    expect(journal).toContain('"cost_usd": 0.0123');
    expect(journal).toContain('"input_tokens": 1000');
    expect(journal).toContain('"total_tokens": 1206');
  });

  it("proceeds without error and reports zero cost when the command reports no usage", () => {
    const project = makeTempProject("command-no-usage");
    enableUsageFrom(project);
    const fixture = join(FIXTURES_DIR, "complete-success.json");

    const res = runCli(["run", project, "no usage reported"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).not.toContain('"topic": "backend.usage"');
  });

  it("does not emit backend.usage when usage_from is left unset (default, no breaking change)", () => {
    const project = makeTempProject("command-usage-disabled");
    // usage_from left at its default ("") — command fixture still writes a
    // usage object, but since AUTOLOOP_USAGE_FILE is never exported (opt-in
    // only), the fixture has nowhere to write it and no event should land.
    const fixture = writeUsageFixture(project, "usage-fixture.json", {
      output: "did the work. LOOP_COMPLETE",
      exit_code: 0,
      delay_ms: 0,
      usage: { cost_usd: 5 },
    });

    const res = runCli(["run", project, "usage_from unset"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).not.toContain('"topic": "backend.usage"');
  });

  it("enforces max_cost_usd budget using command-backend usage telemetry", () => {
    const project = makeTempProject("command-cost-budget");
    enableUsageFrom(project);
    const configPath = join(project, "autoloops.toml");
    const config = readFileSync(configPath, "utf-8");
    // Small budget that a single $0.05 iteration blows past immediately.
    writeFileSync(
      configPath,
      `${config}\nevent_loop.max_cost_usd = 0.01\n`,
      "utf-8",
    );
    // Deliberately does not complete on its own (no LOOP_COMPLETE) so the
    // only way the loop stops after iteration 1 is the cost budget guard.
    const fixture = writeUsageFixture(project, "budget-fixture.json", {
      output: "still working, not done yet.",
      exit_code: 0,
      delay_ms: 0,
      usage: { cost_usd: 0.05 },
    });

    const res = runCli(["run", project, "budget enforcement"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    expect(journal).toContain('"topic": "loop.stop"');
    expect(journal).toContain('"reason": "cost_budget"');
  });
});

describe("integration: command backend live-control interrupt", () => {
  it("commandControlAdapter capabilities advertise interrupt + guidance support", () => {
    const project = makeTempProject("command-control-caps");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    const res = runCli(["run", project, "control capabilities"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    expect(res.status).toBe(0);
    const journal = readText(join(project, ".autoloop/journal.jsonl"));
    const runId = journal.match(/"run": "([^"]+)"/)?.[1] ?? "";
    const capsPath = join(
      project,
      ".autoloop/runs",
      runId,
      "control/capabilities.json",
    );
    expect(pathExists(capsPath)).toBe(true);
    const caps = JSON.parse(readText(capsPath));
    expect(caps.backend).toBe("command");
    expect(caps.interrupt.supported).toBe(true);
    expect(caps.guidance.supported).toBe(true);
  });

  it("`autoloop control interrupt` signals a live command-backend child, which exits and the run stops non-success", async () => {
    const project = makeTempProject("command-interrupt");
    // The mock backend traps SIGUSR1 and exits 130 instead of hanging —
    // simulates a cooperating wrapped CLI that cancels gracefully when the
    // commandControlAdapter's interrupt hook signals it.
    const fixture = writeUsageFixture(project, "trap-fixture.json", {
      output: "",
      exit_code: 0,
      delay_ms: 8000,
      trap_usr1: true,
    });
    const configPath = join(project, "autoloops.toml");
    const config = readFileSync(configPath, "utf-8").replace(
      /backend\.timeout_ms = \d+/,
      "backend.timeout_ms = 20000",
    );
    writeFileSync(configPath, config, "utf-8");

    const mainEntry = join(
      import.meta.dirname,
      "..",
      "..",
      "packages/cli/dist/main.js",
    );
    const child = spawn("node", [mainEntry, "run", project, "interrupt me"], {
      cwd: project,
      env: { ...process.env, MOCK_FIXTURE_PATH: fixture },
    });

    try {
      const runId = await waitForRunId(project, 10_000);
      // Wait for the mock-backend child to actually be spawned (backend.start
      // journaled) plus a small grace period for it to reach the line that
      // registers its SIGUSR1 handler — otherwise the interrupt can race
      // node's own startup and hit the (untrapped) default disposition.
      await waitForJournalContains(project, '"topic": "backend.start"', 10_000);
      await new Promise((r) => setTimeout(r, 500));

      // Real supervisor path: `autoloop control interrupt <run-id>` writes a
      // durable control request and pokes the harness process (SIGUSR1),
      // exactly what an external ralph-style supervisor would do.
      const ctl = runCli(["control", "interrupt", runId], {}, project);
      expect(ctl.stdout).toContain("Interrupt requested");

      // The interrupted iteration's process exits non-zero (mock-backend's
      // SIGUSR1 trap handler exits 130), so the run stops with a non-success
      // reason instead of hanging for the remainder of max_iterations — the
      // process itself still exits 0 (this codebase's CLI convention: the
      // journal's stop reason is the source of truth, not the exit code).
      await waitForExit(child, 15_000);

      const journal = readText(join(project, ".autoloop/journal.jsonl"));
      expect(journal).toContain("mock-backend: interrupted by SIGUSR1");
      expect(journal).toContain('"topic": "loop.stop"');
      expect(journal).not.toContain('"reason": "completed"');
      expect(journal).not.toContain('"reason": "max_iterations"');
    } finally {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }
  }, 30_000);
});

async function waitForRunId(
  project: string,
  timeoutMs: number,
): Promise<string> {
  const journalPath = join(project, ".autoloop/journal.jsonl");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pathExists(journalPath)) {
      const journal = readText(journalPath);
      const match = journal.match(/"run": "([^"]+)"/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for run to start");
}

async function waitForJournalContains(
  project: string,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  const journalPath = join(project, ".autoloop/journal.jsonl");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pathExists(journalPath) && readText(journalPath).includes(needle)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for journal to contain: ${needle}`);
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for child to exit")),
      timeoutMs,
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
