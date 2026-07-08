import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  FIXTURES_DIR,
  makeTempProject,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

function firstRunId(project: string): string {
  const res = runCli(
    ["loops", "--all"],
    { AUTOLOOP_PROJECT_DIR: project },
    project,
  );
  const lines = res.stdout.trim().split("\n");
  expect(lines.length).toBeGreaterThanOrEqual(2);
  return lines[1].trim().split(/\s{2,}/)[0];
}

describe("integration: control command", () => {
  it("prints usage when invoked with no subcommand", () => {
    const project = makeTempProject("ctl-help");
    const res = runCli(["control"], {}, project);
    expect(res.stdout).toContain("autoloop control show");
    expect(res.stdout).toContain("interrupt");
    expect(res.stdout).toContain("guide");
  });

  it("control show reports commandControlAdapter capabilities for a completed command-backend run", () => {
    const project = makeTempProject("ctl-show");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "control show test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    const runId = firstRunId(project);
    const res = runCli(
      ["control", "show", runId],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(res.stdout).toContain(`Run:         ${runId}`);
    expect(res.stdout).toContain("Status:");
    // Issue #34: the `command` backend now publishes live-control
    // capabilities via commandControlAdapter (SIGUSR1 interrupt +
    // journal-durable guidance), so a completed run still has a
    // capabilities.json on disk from when the loop started.
    expect(res.stdout).toContain("Capabilities (backend: command)");
    expect(res.stdout).toContain("interrupt");
    expect(res.stdout).toContain("SIGUSR1");
  });

  it("control capabilities surfaces backend verbs once an adapter is installed", () => {
    const project = makeTempProject("ctl-caps");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "control caps test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    const runId = firstRunId(project);
    // Simulate an adapter having published — drop a hand-written capabilities
    // file in the run's control dir so we can exercise the read path.
    const runStateDir = join(project, ".autoloop", "runs", runId);
    mkdirSync(join(runStateDir, "control"), { recursive: true });
    writeFileSync(
      join(runStateDir, "control", "capabilities.json"),
      JSON.stringify(
        {
          backend: "kiro",
          runId,
          publishedAt: new Date().toISOString(),
          guidance: { supported: true },
          inspect: { supported: true },
          interrupt: {
            supported: true,
            detail: "ACP cancel + child-process-group SIGTERM",
          },
        },
        null,
        2,
      ),
    );

    const res = runCli(
      ["control", "capabilities", runId],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(res.stdout).toContain("backend: kiro");
    expect(res.stdout).toContain("interrupt");
    expect(res.stdout).toContain("ACP cancel");
  });

  it("control guide appends operator.guidance and queues an interrupt request", () => {
    const project = makeTempProject("ctl-guide");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "control guide test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    const runId = firstRunId(project);

    // Publish kiro capabilities so `guide` reports interrupt-supported.
    const runStateDir = join(project, ".autoloop", "runs", runId);
    mkdirSync(join(runStateDir, "control"), { recursive: true });
    writeFileSync(
      join(runStateDir, "control", "capabilities.json"),
      JSON.stringify({
        backend: "kiro",
        runId,
        publishedAt: new Date().toISOString(),
        guidance: { supported: true },
        inspect: { supported: true },
        interrupt: { supported: true, detail: "ACP cancel" },
      }),
    );

    const res = runCli(
      ["control", "guide", runId, "please pivot to plan B"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(res.stdout).toContain(`Guidance queued for ${runId}`);
    expect(res.stdout).toContain("interrupt requested");

    const reqs = readFileSync(
      join(runStateDir, "control", "requests.jsonl"),
      "utf-8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].verb).toBe("guide");
    expect(reqs[0].payload.message).toBe("please pivot to plan B");
    expect(reqs[0].payload.interrupt).toBe(true);

    // Operator guidance must also be durable in the journal recorded for the run
    const registryPath = join(project, ".autoloop", "registry.jsonl");
    const regLines = readFileSync(registryPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const journalFile = regLines.find(
      (r: { run_id: string }) => r.run_id === runId,
    ).journal_file;
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain("operator.guidance");
    expect(journal).toContain("please pivot to plan B");
  });

  it("control guide --no-interrupt queues guidance without requesting an interrupt", () => {
    const project = makeTempProject("ctl-guide-noint");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "control guide test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    const runId = firstRunId(project);
    const res = runCli(
      ["control", "guide", runId, "try this later", "--no-interrupt"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(res.stdout).toContain("interrupt skipped by --no-interrupt");

    const runStateDir = join(project, ".autoloop", "runs", runId);
    const reqPath = join(runStateDir, "control", "requests.jsonl");
    expect(existsSync(reqPath)).toBe(true);
    const reqs = readFileSync(reqPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(reqs[0].payload.interrupt).toBe(false);
  });

  it("control interrupt queues a request against a completed command-backend run", () => {
    const project = makeTempProject("ctl-interrupt-queue");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "control interrupt test"], {
      MOCK_FIXTURE_PATH: fixture,
    });

    const runId = firstRunId(project);
    const res = runCli(
      ["control", "interrupt", runId, "-m", "going off-track"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    // Issue #34: `command` now supports interrupt (commandControlAdapter),
    // so the CLI reports it as requested rather than merely queued — the
    // request is still durably written even though the run already exited.
    expect(res.stdout).toContain("Interrupt requested");

    const runStateDir = join(project, ".autoloop", "runs", runId);
    const reqs = readFileSync(
      join(runStateDir, "control", "requests.jsonl"),
      "utf-8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(reqs[0].verb).toBe("interrupt");
    expect(reqs[0].reason).toBe("going off-track");
  });

  it("control show surfaces pending requests from requests.jsonl", () => {
    const project = makeTempProject("ctl-show-pending");
    const fixture = join(FIXTURES_DIR, "complete-success.json");
    runCli(["run", project, "show pending test"], {
      MOCK_FIXTURE_PATH: fixture,
    });
    const runId = firstRunId(project);

    // Queue an interrupt request directly (parent process is already gone).
    const interruptRes = runCli(
      ["control", "interrupt", runId, "-m", "please stop"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(interruptRes.stdout).toContain("Interrupt requested");

    const show = runCli(
      ["control", "show", runId],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(show.stdout).toContain("Recent control activity");
    expect(show.stdout).toContain("pending");
    expect(show.stdout).toContain("interrupt");
    expect(show.stdout).toContain("please stop");
  });

  it("reports an error when the run does not exist", () => {
    const project = makeTempProject("ctl-missing");
    const res = runCli(
      ["control", "show", "run-does-not-exist"],
      { AUTOLOOP_PROJECT_DIR: project },
      project,
    );
    expect(res.stdout).toContain("No run matching");
  });
});
