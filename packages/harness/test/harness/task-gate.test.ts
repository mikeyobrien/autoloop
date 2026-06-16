import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import {
  addTask,
  completeTask,
  removeTask,
} from "@mobrienv/autoloop-core/tasks";
import { emit } from "@mobrienv/autoloop-harness/emit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot complete");
    expect(result.error).toContain("task-1");
    expect(result.error).toContain("unfinished work");

    // Verify task.gate event was written to journal
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain("task.gate");
  });

  it("allows completion when all tasks are done", () => {
    addTask(dir, "finished work", "manual");
    completeTask(dir, "task-1");

    const result = emit(dir, "task.complete", "all done");

    expect(result.ok).toBe(true);
  });

  it("allows completion when no tasks file exists", () => {
    const result = emit(dir, "task.complete", "no tasks");

    expect(result.ok).toBe(true);
  });

  it("allows completion when tasks are removed via tombstone", () => {
    addTask(dir, "removed work", "manual");
    removeTask(dir, "task-1", "not needed");

    const result = emit(dir, "task.complete", "clean");

    expect(result.ok).toBe(true);
  });

  it("does not gate non-completion events", () => {
    addTask(dir, "open task", "manual");
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "");

    const result = emit(dir, "research.complete", "partial progress");

    expect(result.ok).toBe(true);
  });

  it("allows completion when only soft tasks remain open", () => {
    addTask(dir, "advisory cleanup", "manual", { soft: true });
    addTask(dir, "advisory docs", "manual", { soft: true, priority: "low" });

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(true);
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).not.toContain("task.gate");
  });

  it("blocks on mixed soft and blocking tasks, listing only blocking ids", () => {
    addTask(dir, "soft advisory", "manual", { soft: true });
    addTask(dir, "must finish", "manual");
    addTask(dir, "urgent must finish", "manual", { priority: "high" });

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot complete: 2 open tasks remain");
    expect(result.error).toContain("task-2");
    expect(result.error).toContain("task-3");
    expect(result.error).not.toContain("task-1");

    // task.gate event lists only blocking ids
    const journal = readFileSync(journalFile, "utf-8");
    const gateLine = journal.split("\n").find((l) => l.includes("task.gate"));
    expect(gateLine).toBeDefined();
    expect(gateLine).toContain("task-2");
    expect(gateLine).toContain("task-3");
    expect(gateLine).not.toMatch(/task-1/);
  });

  it("blocks on default (non-soft) tasks exactly as before", () => {
    addTask(dir, "legacy default task", "manual");

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("task-1");
  });

  it("gates on the run-scoped tasks file (AUTOLOOP_TASKS_FILE), not the project default", () => {
    // The pulled queue lives in a run-scoped file distinct from the project-level
    // .autoloop/tasks.jsonl. The gate must read THIS file (the same one pull seeds,
    // the agent completes into, and push reads) — else runs complete with synced
    // issues still open. Regression for the resolveTasksFile→resolveFile fix.
    const runTasks = join(dir, ".autoloop/runs/run-1/tasks.jsonl");
    mkdirSync(dirname(runTasks), { recursive: true });
    vi.stubEnv("AUTOLOOP_TASKS_FILE", runTasks);
    addTask(dir, "run-scoped unfinished", "linear:abc");

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("run-scoped unfinished");
  });

  it("allows completion after blocking tasks are done and only soft remain", () => {
    addTask(dir, "blocking", "manual");
    addTask(dir, "soft leftover", "manual", { soft: true });
    completeTask(dir, "task-1");

    const result = emit(dir, "task.complete", "done");

    expect(result.ok).toBe(true);
  });
});
