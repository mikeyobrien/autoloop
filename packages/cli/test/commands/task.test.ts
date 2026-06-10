import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchTask } from "../../src/commands/task.js";

function tmpProject(): string {
  const dir = join(
    tmpdir(),
    `autoloop-ts-task-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  return dir;
}

describe("dispatchTask", () => {
  let dir: string;
  let tasksFile: string;
  let lines: string[];

  beforeEach(() => {
    dir = tmpProject();
    tasksFile = join(dir, ".autoloop/tasks.jsonl");
    vi.stubEnv("AUTOLOOP_PROJECT_DIR", dir);
    vi.stubEnv("AUTOLOOP_TASKS_FILE", tasksFile);
    lines = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("add without flags creates a default task", () => {
    dispatchTask(["add", "plain", "task"]);

    expect(lines).toEqual(["task-1"]);
    const raw = readFileSync(tasksFile, "utf-8");
    expect(raw).toContain('"text": "plain task"');
    expect(raw).not.toContain("priority");
    expect(raw).not.toContain("soft");
  });

  it("add accepts --priority and --soft", () => {
    dispatchTask(["add", "--priority", "high", "--soft", "urgent", "hint"]);

    expect(lines).toEqual(["task-1"]);
    const raw = readFileSync(tasksFile, "utf-8");
    expect(raw).toContain('"text": "urgent hint"');
    expect(raw).toContain('"priority": "high"');
    expect(raw).toContain('"soft": "true"');
  });

  it("add accepts -p shorthand with flags after the text", () => {
    dispatchTask(["add", "slow", "burner", "-p", "low"]);

    expect(lines).toEqual(["task-1"]);
    const raw = readFileSync(tasksFile, "utf-8");
    expect(raw).toContain('"text": "slow burner"');
    expect(raw).toContain('"priority": "low"');
  });

  it("add rejects an invalid priority value with usage", () => {
    dispatchTask(["add", "-p", "urgent", "some", "task"]);

    expect(lines[0]).toContain("Usage: autoloop task add");
    expect(lines[0]).toContain("--priority|-p <high|normal|low>");
    expect(lines[0]).toContain("--soft");
  });

  it("add without text prints usage", () => {
    dispatchTask(["add"]);
    expect(lines[0]).toContain("Usage: autoloop task add");
  });

  it("add --help prints usage", () => {
    dispatchTask(["add", "--help"]);
    expect(lines[0]).toContain("Usage: autoloop task add");
  });

  it("list shows priority/soft markers ordered high → normal → low", () => {
    dispatchTask(["add", "normal", "one"]);
    dispatchTask(["add", "-p", "low", "--soft", "low", "soft", "one"]);
    dispatchTask(["add", "-p", "high", "high", "one"]);
    lines = [];

    dispatchTask(["list"]);

    const output = lines.join("\n");
    const openLines = output.split("\n").filter((l) => l.startsWith("- [ ]"));
    expect(openLines).toEqual([
      "- [ ] [task-3] [high] high one",
      "- [ ] [task-1] normal one",
      "- [ ] [task-2] [low] low soft one (soft)",
    ]);
  });

  it("complete and list keep markers on done tasks", () => {
    dispatchTask(["add", "-p", "high", "finish", "me"]);
    dispatchTask(["complete", "task-1"]);
    lines = [];

    dispatchTask(["list"]);

    const output = lines.join("\n");
    expect(output).toContain("Done:");
    expect(output).toContain("- [x] [task-1] [high] finish me");
  });
});
