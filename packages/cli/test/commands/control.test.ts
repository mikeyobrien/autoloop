import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchControl } from "../../src/commands/control.js";

let projectDir: string;
let originalProjectDir: string | undefined;
let originalStateDir: string | undefined;
let originalExitCode: string | number | undefined;
let output: string[];

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "autoloop-control-custom-root-"));
  originalProjectDir = process.env.AUTOLOOP_PROJECT_DIR;
  originalStateDir = process.env.AUTOLOOP_STATE_DIR;
  originalExitCode = process.exitCode;
  process.env.AUTOLOOP_PROJECT_DIR = projectDir;
  delete process.env.AUTOLOOP_STATE_DIR;
  process.exitCode = 0;
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    output.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalProjectDir === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
  else process.env.AUTOLOOP_PROJECT_DIR = originalProjectDir;
  if (originalStateDir === undefined) delete process.env.AUTOLOOP_STATE_DIR;
  else process.env.AUTOLOOP_STATE_DIR = originalStateDir;
  process.exitCode = originalExitCode;
  rmSync(projectDir, { recursive: true, force: true });
});

describe("control custom-root chain child discovery", () => {
  it("resolves the child for show, capabilities, interrupt, guide, and respond", () => {
    const stateDirRelativePath = join(".ralph", "autoloop");
    const stateDir = join(projectDir, stateDirRelativePath);
    const childStateDir = join(
      stateDir,
      "chains",
      "chain-custom",
      "step-1",
      stateDirRelativePath,
    );
    const runId = "control-chain-child-001";
    const runStateDir = join(childStateDir, "runs", runId);
    const journalFile = join(runStateDir, "journal.jsonl");
    const now = new Date().toISOString();
    const record: RunRecord = {
      run_id: runId,
      status: "running",
      preset: "autocode",
      objective: "control a custom-root chain child",
      trigger: "chain",
      project_dir: projectDir,
      work_dir: projectDir,
      state_dir: runStateDir,
      journal_file: journalFile,
      parent_run_id: "chain-custom",
      backend: "mock",
      backend_args: [],
      created_at: now,
      updated_at: now,
      iteration: 1,
      max_iterations: 10,
      stop_reason: "",
      latest_event: "loop.start",
      isolation_mode: "run-scoped",
      worktree_name: "",
      worktree_path: "",
    };

    writeFileSync(
      join(projectDir, "autoloops.toml"),
      '[core]\nstate_dir = ".ralph/autoloop"\n',
      "utf-8",
    );
    mkdirSync(runStateDir, { recursive: true });
    writeFileSync(join(stateDir, "registry.jsonl"), "", "utf-8");
    writeFileSync(
      join(childStateDir, "registry.jsonl"),
      `${JSON.stringify(record)}\n`,
      "utf-8",
    );
    writeFileSync(
      journalFile,
      `${JSON.stringify({
        run: runId,
        topic: "loop.start",
        iteration: "1",
        timestamp: now,
        fields: { preset: "autocode" },
      })}\n`,
      "utf-8",
    );
    const controlDir = join(runStateDir, "control");
    mkdirSync(controlDir, { recursive: true });
    writeFileSync(
      join(controlDir, "capabilities.json"),
      JSON.stringify({
        backend: "mock",
        runId,
        publishedAt: now,
        guidance: { supported: true },
        interrupt: { supported: true },
        inspect: { supported: true },
      }),
      "utf-8",
    );

    const prefix = "control-chain-child";
    dispatchControl(["show", prefix]);
    dispatchControl(["capabilities", prefix]);
    dispatchControl(["interrupt", prefix, "-m", "pause child"]);
    dispatchControl(["guide", prefix, "focus child", "--no-interrupt"]);
    dispatchControl(["respond", prefix, "question-1", "child answer"]);

    expect(output.join("\n")).toContain(`Run:         ${runId}`);
    expect(output.join("\n")).toContain("Capabilities (backend: mock)");
    expect(output.join("\n")).toContain(`Interrupt requested for ${runId}`);
    expect(output.join("\n")).toContain(`Guidance queued for ${runId}`);
    expect(output.join("\n")).toContain(
      `Response delivered to ${runId} for question question-1.`,
    );
    expect(readFileSync(journalFile, "utf-8")).toContain("focus child");

    const requests = readFileSync(join(controlDir, "requests.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests.map((request) => request.verb)).toEqual([
      "interrupt",
      "guide",
      "respond",
    ]);
    expect(requests[2].payload).toEqual({
      questionId: "question-1",
      answer: "child answer",
    });
    expect(process.exitCode).toBe(0);
  });
});
