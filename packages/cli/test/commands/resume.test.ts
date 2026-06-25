import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the harness so we capture what dispatchResume forwards without driving
// a real loop.
const resumeSpy = vi.fn(async () => ({
  iterations: 5,
  stopReason: "completed",
  runId: "run-aaaa",
  resumedFromIteration: 4,
  newMaxIterations: 5,
}));
vi.mock("@mobrienv/autoloop-harness", () => ({
  resume: (...args: unknown[]) => resumeSpy(...args),
}));

vi.mock("../../src/cli/event-printer.js", () => ({
  cliPrintEvent: vi.fn(),
}));

import { dispatchResume } from "../../src/commands/resume.js";

let projectDir: string;
const origProjectDir = process.env.AUTOLOOP_PROJECT_DIR;

function baseRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const stateDir = join(projectDir, ".autoloop");
  return {
    run_id: "run-aaaa",
    status: "stopped",
    preset: "test",
    objective: "obj",
    trigger: "cli",
    project_dir: projectDir,
    work_dir: projectDir,
    state_dir: stateDir,
    journal_file: join(stateDir, "journal.jsonl"),
    parent_run_id: "",
    backend: "echo",
    backend_args: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    iteration: 3,
    max_iterations: 3,
    stop_reason: "max_iterations",
    latest_event: "loop.stop",
    isolation_mode: "run-scoped",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

function writeRegistry(records: RunRecord[]): void {
  const stateDir = join(projectDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "registry.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf-8",
  );
  // Ensure the journal file referenced by records exists (validation checks it).
  for (const r of records) {
    if (r.journal_file) writeFileSync(r.journal_file, "", "utf-8");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  projectDir = mkdtempSync(join(tmpdir(), "autoloop-resume-cli-"));
  process.env.AUTOLOOP_PROJECT_DIR = projectDir;
});

afterEach(() => {
  process.exitCode = 0;
  if (origProjectDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
  else process.env.AUTOLOOP_PROJECT_DIR = origProjectDir;
  rmSync(projectDir, { recursive: true, force: true });
});

describe("dispatchResume", () => {
  it("resumes a terminated run, forwarding add-iterations and baseStateDir", async () => {
    writeRegistry([baseRecord()]);
    await dispatchResume(["run-aaaa", "--add-iterations", "2"]);

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    const [record, opts] = resumeSpy.mock.calls[0] as [
      RunRecord,
      Record<string, unknown>,
    ];
    expect(record.run_id).toBe("run-aaaa");
    expect(opts.addIterations).toBe(2);
    expect(opts.baseStateDir).toBe(join(projectDir, ".autoloop"));
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("resolves a run by prefix", async () => {
    writeRegistry([baseRecord()]);
    await dispatchResume(["run-a"]);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards a -b backend override spec", async () => {
    writeRegistry([baseRecord()]);
    await dispatchResume(["run-aaaa", "-b", "pi"]);
    const [, opts] = resumeSpy.mock.calls[0] as [
      RunRecord,
      Record<string, unknown>,
    ];
    expect(opts.backendOverride).toMatchObject({ kind: "pi", command: "pi" });
  });

  it("refuses to resume a completed run", async () => {
    writeRegistry([baseRecord({ status: "completed" })]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-aaaa"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("already completed"),
    );
    expect(process.exitCode).toBe(2);
    stderr.mockRestore();
  });

  it("refuses to resume a run still running with a live pid", async () => {
    writeRegistry([baseRecord({ status: "running", pid: process.pid })]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-aaaa"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("still running"),
    );
    stderr.mockRestore();
  });

  it("resumes a crashed running run whose pid is dead", async () => {
    // pid 1 is init; process.kill(1, 0) throws EPERM for an unprivileged
    // process, which our liveness check treats as not-our-process. Use a pid
    // that is virtually guaranteed dead.
    writeRegistry([baseRecord({ status: "running", pid: 2 ** 30 })]);
    await dispatchResume(["run-aaaa"]);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses when the run id is unknown", async () => {
    writeRegistry([baseRecord()]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-zzzz"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("no run matching"),
    );
    stderr.mockRestore();
  });

  it("refuses an ambiguous prefix", async () => {
    writeRegistry([
      baseRecord({ run_id: "run-abc" }),
      baseRecord({ run_id: "run-abd" }),
    ]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-ab"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("ambiguous"));
    stderr.mockRestore();
  });

  it("refuses --add-iterations 0", async () => {
    writeRegistry([baseRecord()]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-aaaa", "--add-iterations", "0"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("no iterations to run"),
    );
    stderr.mockRestore();
  });

  it("refuses a worktree-mode run whose worktree was cleaned up", async () => {
    writeRegistry([
      baseRecord({
        isolation_mode: "worktree",
        worktree_path: join(projectDir, "gone-worktree"),
      }),
    ]);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await dispatchResume(["run-aaaa"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("was cleaned up"),
    );
    stderr.mockRestore();
  });

  it("prints usage for --help without resuming", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await dispatchResume(["--help"]);
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("autoloop resume"),
    );
    log.mockRestore();
  });
});
