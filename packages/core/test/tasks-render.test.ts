import { describe, expect, it } from "vitest";
import type { MaterializedTasks } from "../src/tasks.js";
import { renderTasksPrompt } from "../src/tasks-render.js";

describe("renderTasksPrompt", () => {
  it("returns empty string for no tasks", () => {
    expect(renderTasksPrompt({ open: [], done: [] }, 4000)).toBe("");
  });

  it("renders open and done tasks with header", () => {
    const tasks: MaterializedTasks = {
      open: [
        {
          id: "task-1",
          type: "task",
          text: "implement parsing",
          status: "open",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
        },
      ],
      done: [
        {
          id: "task-2",
          type: "task",
          text: "set up project",
          status: "done",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
          completed: "2026-01-01T01:00:00Z",
        },
      ],
    };

    const result = renderTasksPrompt(tasks, 4000);
    expect(result).toContain("Tasks:");
    expect(result).toContain("Open:");
    expect(result).toContain("- [ ] [task-1] implement parsing");
    expect(result).toContain("Done:");
    expect(result).toContain("- [x] [task-2] set up project (done)");
  });

  it("truncates when over budget", () => {
    const tasks: MaterializedTasks = {
      open: [
        {
          id: "task-1",
          type: "task",
          text: "A".repeat(100),
          status: "open",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
        },
        {
          id: "task-2",
          type: "task",
          text: "B".repeat(100),
          status: "open",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
        },
      ],
      done: [
        {
          id: "task-3",
          type: "task",
          text: "C".repeat(100),
          status: "done",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
          completed: "2026-01-01T01:00:00Z",
        },
      ],
    };

    const result = renderTasksPrompt(tasks, 50);
    expect(result).toContain("...");
    expect(result).toContain("tasks truncated:");
  });

  it("returns full text when budget is 0 (disabled)", () => {
    const tasks: MaterializedTasks = {
      open: [
        {
          id: "task-1",
          type: "task",
          text: "something",
          status: "open",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
        },
      ],
      done: [],
    };

    const result = renderTasksPrompt(tasks, 0);
    expect(result).toContain("- [ ] [task-1] something");
    expect(result).not.toContain("truncated");
  });
});
