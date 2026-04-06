import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTask,
  completeTask,
  listTasks,
  materialize,
  materializeOpen,
  removeTask,
  renderTaskList,
  updateTask,
} from "../src/tasks.js";

function tmpProject(): string {
  const dir = join(
    tmpdir(),
    `autoloop-ts-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  writeFileSync(join(dir, "autoloops.toml"), "");
  return dir;
}

describe("materialize", () => {
  it("returns empty for no lines", () => {
    const result = materialize([]);
    expect(result.open).toHaveLength(0);
    expect(result.done).toHaveLength(0);
  });

  it("materializes open and done tasks", () => {
    const lines = [
      '{"id": "task-1", "type": "task", "text": "first", "status": "open", "source": "manual", "created": "2026-01-01T00:00:00Z"}',
      '{"id": "task-2", "type": "task", "text": "second", "status": "done", "source": "manual", "created": "2026-01-01T00:00:00Z", "completed": "2026-01-01T01:00:00Z"}',
    ];
    const result = materialize(lines);
    expect(result.open).toHaveLength(1);
    expect(result.open[0].id).toBe("task-1");
    expect(result.done).toHaveLength(1);
    expect(result.done[0].id).toBe("task-2");
  });

  it("latest entry wins for same ID", () => {
    const lines = [
      '{"id": "task-1", "type": "task", "text": "original", "status": "open", "source": "manual", "created": "2026-01-01T00:00:00Z"}',
      '{"id": "task-1", "type": "task", "text": "updated", "status": "done", "source": "manual", "created": "2026-01-01T00:00:00Z", "completed": "2026-01-01T02:00:00Z"}',
    ];
    const result = materialize(lines);
    expect(result.open).toHaveLength(0);
    expect(result.done).toHaveLength(1);
    expect(result.done[0].text).toBe("updated");
  });

  it("tombstones remove tasks", () => {
    const lines = [
      '{"id": "task-1", "type": "task", "text": "doomed", "status": "open", "source": "manual", "created": "2026-01-01T00:00:00Z"}',
      '{"id": "ts-2", "type": "task-tombstone", "target_id": "task-1", "reason": "not needed", "created": "2026-01-01T01:00:00Z"}',
    ];
    const result = materialize(lines);
    expect(result.open).toHaveLength(0);
    expect(result.done).toHaveLength(0);
  });

  it("open tasks sorted oldest first", () => {
    const lines = [
      '{"id": "task-1", "type": "task", "text": "first", "status": "open", "source": "manual", "created": "2026-01-01T00:00:00Z"}',
      '{"id": "task-2", "type": "task", "text": "second", "status": "open", "source": "manual", "created": "2026-01-02T00:00:00Z"}',
    ];
    const result = materialize(lines);
    expect(result.open[0].id).toBe("task-1");
    expect(result.open[1].id).toBe("task-2");
  });
});

describe("CRUD operations", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpProject();
    vi.stubEnv("AUTOLOOP_TASKS_FILE", join(dir, ".autoloop/tasks.jsonl"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("addTask creates an open task and returns its ID", () => {
    const id = addTask(dir, "implement frobnicator", "manual");
    expect(id).toBe("task-1");
    const raw = readFileSync(join(dir, ".autoloop/tasks.jsonl"), "utf-8");
    expect(raw).toContain("implement frobnicator");
    expect(raw).toContain('"status": "open"');
  });

  it("addTask increments IDs", () => {
    const id1 = addTask(dir, "first", "manual");
    const id2 = addTask(dir, "second", "iter-3");
    expect(id1).toBe("task-1");
    expect(id2).toBe("task-2");
  });

  it("completeTask marks a task as done", () => {
    addTask(dir, "do the thing", "manual");
    const ok = completeTask(dir, "task-1");
    expect(ok).toBe(true);

    const open = materializeOpen(dir);
    expect(open).toHaveLength(0);
  });

  it("completeTask returns false for unknown ID", () => {
    expect(completeTask(dir, "task-999")).toBe(false);
  });

  it("updateTask changes text", () => {
    addTask(dir, "original text", "manual");
    const ok = updateTask(dir, "task-1", "revised text");
    expect(ok).toBe(true);

    const list = listTasks(dir);
    expect(list).toContain("revised text");
    expect(list).not.toContain("original text");
  });

  it("removeTask tombstones a task", () => {
    addTask(dir, "delete me", "manual");
    const ok = removeTask(dir, "task-1", "not needed");
    expect(ok).toBe(true);

    const list = listTasks(dir);
    expect(list).toBe("No tasks.");
  });

  it("removeTask returns false for unknown ID", () => {
    expect(removeTask(dir, "task-999", "nope")).toBe(false);
  });
});

describe("renderTaskList", () => {
  it("returns 'No tasks.' for empty", () => {
    expect(renderTaskList({ open: [], done: [] })).toBe("No tasks.");
  });

  it("renders open and done sections", () => {
    const result = renderTaskList({
      open: [
        {
          id: "task-1",
          type: "task",
          text: "implement",
          status: "open",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
        },
      ],
      done: [
        {
          id: "task-2",
          type: "task",
          text: "scaffold",
          status: "done",
          source: "manual",
          created: "2026-01-01T00:00:00Z",
          completed: "2026-01-01T01:00:00Z",
        },
      ],
    });
    expect(result).toContain("Open:");
    expect(result).toContain("- [ ] [task-1] implement");
    expect(result).toContain("Done:");
    expect(result).toContain("- [x] [task-2] scaffold");
  });
});
