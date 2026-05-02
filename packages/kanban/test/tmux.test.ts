import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Task } from "../src/task_store.js";
import {
  shellEscape,
  TMUX_SOCKET,
  tmuxConfPath,
  tmuxSessionName,
} from "../src/tmux.js";

describe("tmux helpers", () => {
  it("tmuxConfPath returns a file that exists on disk", () => {
    const p = tmuxConfPath();
    expect(existsSync(p)).toBe(true);
  });

  it("tmux config file contains autoloop branding and no kermes references", () => {
    const body = readFileSync(tmuxConfPath(), "utf8");
    expect(body).toContain("autoloop");
    expect(body).not.toMatch(/kermes/i);
  });

  it("shellEscape wraps and escapes single quotes", () => {
    expect(shellEscape("it's a test")).toBe("'it'\\''s a test'");
  });

  it("tmuxSessionName uses kanban-<taskId> format", () => {
    const task = { id: "task-abc" } as unknown as Task;
    expect(tmuxSessionName(task)).toBe("kanban-task-abc");
  });

  it("TMUX_SOCKET is autoloop-kanban", () => {
    expect(TMUX_SOCKET).toBe("autoloop-kanban");
  });
});
