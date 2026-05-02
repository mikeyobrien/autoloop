import { describe, expect, it } from "vitest";
import type { Task } from "../src/task_store.js";
import { renderArchivePage } from "../src/views/archive.js";
import { renderPage } from "../src/views/board.js";
import { renderCard } from "../src/views/card.js";
import { renderFullscreenTerm } from "../src/views/term.js";

const noGit = () => false;

describe("renderPage", () => {
  it("renders an empty board with autoloop title and no chat surface", () => {
    const out = renderPage([], "test-scope", true);
    expect(out).toContain("<title>Autoloop Kanban</title>");
    expect(out).toContain("<h1>Autoloop Kanban</h1>");
    expect(out).toContain("scope=test-scope");
    expect(out).toContain("No tasks yet");
    expect(/kermes/i.test(out)).toBe(false);
    expect(out).not.toContain("new-chat-btn");
    expect(out).not.toContain("btn-menu");
    expect(out).not.toContain("drawer");
  });
});

describe("renderCard", () => {
  it("reflects autoloop run_id/state and HTML-escapes the title", () => {
    const task = {
      id: "t1",
      title: "hello <world>",
      status: "in_progress",
      priority: 3,
      blocked_by: [],
      scope: "/tmp/project",
      created: new Date().toISOString(),
      autoloop: {
        run_id: "r1",
        state: "running",
        workspace: "/tmp",
        started: new Date().toISOString(),
        last_active: new Date().toISOString(),
      },
    } as unknown as Task;
    const out = renderCard(task, noGit);
    expect(out).toContain('data-id="t1"');
    expect(out).toContain('data-state="running"');
    expect(out).toContain("state-running");
    expect(out).toContain("hello &lt;world&gt;");
    expect(/kermes/i.test(out)).toBe(false);
  });
});

describe("renderFullscreenTerm", () => {
  it("escapes title, labels tab as autoloop, wires ws to taskId", () => {
    const task = { id: "t1", title: "hello < world" } as unknown as Task;
    const out = renderFullscreenTerm(task);
    expect(out).toContain("<title>hello &lt; world — autoloop</title>");
    expect(out).toContain("taskId=t1");
    expect(/kermes/i.test(out)).toBe(false);
  });
});

describe("renderArchivePage", () => {
  it("renders an empty archive with autoloop branding and no slash-command hint", () => {
    const out = renderArchivePage([], "test-scope");
    expect(out).toContain("<title>Autoloop — Archive</title>");
    expect(out).toContain("Autoloop — Archive");
    expect(out).toContain("Archive empty");
    expect(out).not.toContain("<code>/task archive</code>");
    expect(/kermes/i.test(out)).toBe(false);
  });
});

describe("hard-gate: no kermes leakage", () => {
  const sample = {
    id: "abc",
    title: "sample",
    status: "in_progress",
    priority: 3,
    blocked_by: [],
    scope: "/tmp",
    created: new Date().toISOString(),
  } as unknown as Task;
  it.each([
    ["renderPage", () => renderPage([sample], "scope", false)],
    ["renderCard", () => renderCard(sample, noGit)],
    ["renderFullscreenTerm", () => renderFullscreenTerm(sample)],
    ["renderArchivePage", () => renderArchivePage([sample], "scope")],
  ])("%s output contains zero kermes substrings", (_name, fn) => {
    expect(/kermes/i.test(fn())).toBe(false);
  });
});
