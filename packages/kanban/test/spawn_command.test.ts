import { describe, expect, it } from "vitest";
import { buildAutoloopCommand } from "../src/spawn.js";
import type { Task } from "../src/task_store.js";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-abc",
    title: "fix bug",
    status: "open",
    priority: 3,
    blocked_by: [],
    scope: "/home/user/proj",
    created: "2026-05-02T00:00:00Z",
    ...overrides,
  } as Task;
}

describe("buildAutoloopCommand", () => {
  it("emits env prefix + autoloop run <preset> <prompt> with no description", () => {
    const task = makeTask({});
    const cmd = buildAutoloopCommand(task, "kanban-task-abc", {
      autoloopBin: "autoloop",
      defaultPreset: "autocode",
    });
    expect(cmd).toBe(
      "AUTOLOOP_KANBAN_TASK_ID='task-abc' AUTOLOOP_KANBAN_RUN_ID='kanban-task-abc' 'autoloop' run 'autocode' 'fix bug'",
    );
  });

  it("joins title and description with a blank line separator", () => {
    const task = makeTask({ description: "long description here" });
    const cmd = buildAutoloopCommand(task, "kanban-task-abc", {
      autoloopBin: "autoloop",
      defaultPreset: "autocode",
    });
    expect(cmd).toContain("'fix bug\n\nlong description here'");
  });

  it("prefers task.preset over defaultPreset", () => {
    const task = makeTask({ preset: "review" });
    const cmd = buildAutoloopCommand(task, "kanban-task-abc", {
      autoloopBin: "autoloop",
      defaultPreset: "autocode",
    });
    expect(cmd).toContain(" run 'review' ");
    expect(cmd).not.toContain(" run 'autocode' ");
  });

  it("single-quote-wraps autoloopBin paths that contain spaces", () => {
    const task = makeTask({});
    const cmd = buildAutoloopCommand(task, "kanban-task-abc", {
      autoloopBin: "/abs path/with space/autoloop",
      defaultPreset: "autocode",
    });
    expect(cmd).toContain("'/abs path/with space/autoloop'");
  });

  it("escapes embedded single quotes in the prompt", () => {
    const task = makeTask({ title: "it's broken" });
    const cmd = buildAutoloopCommand(task, "kanban-task-abc", {
      autoloopBin: "autoloop",
      defaultPreset: "autocode",
    });
    expect(cmd.endsWith("'it'\\''s broken'")).toBe(true);
  });
});
