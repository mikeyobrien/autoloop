import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "../../src/harness/emit.js";
import { appendEvent } from "../../src/harness/journal.js";
import { addTask, completeTask, removeTask } from "../../src/tasks.js";

function tmpProject(): string {
  const dir = join(
    tmpdir(),
    `autoloop-ts-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  writeFileSync(join(dir, "autoloops.toml"), "");
  return dir;
}

describe("task completion gate", () => {
  let dir: string;
  let journalFile: string;
  let tasksFile: string;

  beforeEach(() => {
    dir = tmpProject();
    journalFile = join(dir, ".autoloop/journal.jsonl");
    tasksFile = join(dir, ".autoloop/tasks.jsonl");

    // Bootstrap a run in the journal
    appendEvent(journalFile, "run-1", "1", "loop.start", "");

    vi.stubEnv("AUTOLOOP_PROJECT_DIR", dir);
    vi.stubEnv("AUTOLOOP_JOURNAL_FILE", journalFile);
    vi.stubEnv("AUTOLOOP_RUN_ID", "run-1");
    vi.stubEnv("AUTOLOOP_ITERATION", "1");
    vi.stubEnv("AUTOLOOP_TASKS_FILE", tasksFile);
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "");
    vi.stubEnv("AUTOLOOP_RECENT_EVENT", "loop.start");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it("blocks completion when open tasks remain", () => {
    addTask(dir, "unfinished work", "manual");

    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emit(dir, "task.complete", "done");

    expect(process.exitCode).toBe(1);
    const output = stderrWrite.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Cannot complete");
    expect(output).toContain("task-1");
    expect(output).toContain("unfinished work");

    stderrWrite.mockRestore();

    // Verify task.gate event was written to journal
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain("task.gate");
  });

  it("allows completion when all tasks are done", () => {
    addTask(dir, "finished work", "manual");
    completeTask(dir, "task-1");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emit(dir, "task.complete", "all done");

    expect(process.exitCode).toBe(0);
    consoleSpy.mockRestore();
  });

  it("allows completion when no tasks file exists", () => {
    // No tasks file at all — should pass through
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emit(dir, "task.complete", "no tasks");

    expect(process.exitCode).toBe(0);
    consoleSpy.mockRestore();
  });

  it("allows completion when tasks are removed via tombstone", () => {
    addTask(dir, "removed work", "manual");
    removeTask(dir, "task-1", "not needed");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emit(dir, "task.complete", "clean");

    expect(process.exitCode).toBe(0);
    consoleSpy.mockRestore();
  });

  it("does not gate non-completion events", () => {
    addTask(dir, "open task", "manual");
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emit(dir, "research.complete", "partial progress");

    expect(process.exitCode).toBe(0);
    consoleSpy.mockRestore();
  });
});
