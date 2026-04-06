import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as config from "./config.js";
import { readLines } from "./harness/journal.js";
import { extractField, jsonField } from "./json.js";

export interface TaskEntry {
  id: string;
  type: "task" | "task-tombstone";
  text: string;
  status: "open" | "done";
  source: string;
  created: string;
  completed?: string;
}

export interface MaterializedTasks {
  open: TaskEntry[];
  done: TaskEntry[];
}

export function resolveFile(projectDir: string): string {
  const envPath = process.env.AUTOLOOP_TASKS_FILE;
  if (envPath) return envPath;
  const cfg = config.loadProject(projectDir);
  return join(
    projectDir,
    config.get(cfg, "core.tasks_file", ".autoloop/tasks.jsonl"),
  );
}

export function resolveFileIn(projectDir: string, workDir: string): string {
  const envPath = process.env.AUTOLOOP_TASKS_FILE;
  if (envPath) return envPath;
  const cfg = config.loadProject(projectDir);
  return join(
    workDir,
    config.get(cfg, "core.tasks_file", ".autoloop/tasks.jsonl"),
  );
}

export function materialize(lines: string[]): MaterializedTasks {
  const reversed = [...lines].reverse();
  const seen: string[] = [];
  const tombstoned: string[] = [];
  const open: TaskEntry[] = [];
  const done: TaskEntry[] = [];

  for (const line of reversed) {
    const type = extractField(line, "type");
    const id = extractField(line, "id");

    if (type === "task-tombstone") {
      const targetId = extractField(line, "target_id");
      tombstoned.push(targetId);
      continue;
    }

    if (type !== "task") continue;
    if (!id) continue;
    if (tombstoned.includes(id) || seen.includes(id)) continue;
    seen.push(id);

    const entry = parseEntry(line);
    if (entry.status === "done") {
      done.push(entry);
    } else {
      open.push(entry);
    }
  }

  // Open: oldest first (by creation). Done: most recent completion first.
  return {
    open: open.reverse(),
    done: done.reverse(),
  };
}

function parseEntry(line: string): TaskEntry {
  return {
    id: extractField(line, "id"),
    type: "task",
    text: extractField(line, "text"),
    status: extractField(line, "status") === "done" ? "done" : "open",
    source: extractField(line, "source") || "manual",
    created: extractField(line, "created"),
    completed: extractField(line, "completed") || undefined,
  };
}

export function materializeOpen(projectDir: string): TaskEntry[] {
  const path = resolveFile(projectDir);
  const lines = readLines(path);
  if (lines.length === 0) return [];
  return materialize(lines).open;
}

export function materializeOpenFrom(path: string): TaskEntry[] {
  const lines = readLines(path);
  if (lines.length === 0) return [];
  return materialize(lines).open;
}

export function addTask(
  projectDir: string,
  text: string,
  source: string,
): string {
  const path = resolveFile(projectDir);
  const id = nextId(path);
  appendEntry(
    path,
    taskLine(
      id,
      "task",
      jsonField("text", text) +
        ", " +
        jsonField("status", "open") +
        ", " +
        jsonField("source", source) +
        ", " +
        jsonField("created", currentTime()),
    ),
  );
  return id;
}

export function completeTask(projectDir: string, id: string): boolean {
  const path = resolveFile(projectDir);
  const tasks = materialize(readLines(path));
  const entry = [...tasks.open, ...tasks.done].find((t) => t.id === id);
  if (!entry) return false;
  if (entry.status === "done") return false;
  appendEntry(
    path,
    taskLine(
      id,
      "task",
      jsonField("text", entry.text) +
        ", " +
        jsonField("status", "done") +
        ", " +
        jsonField("source", entry.source) +
        ", " +
        jsonField("created", entry.created) +
        ", " +
        jsonField("completed", currentTime()),
    ),
  );
  return true;
}

export function updateTask(
  projectDir: string,
  id: string,
  text: string,
): boolean {
  const path = resolveFile(projectDir);
  const tasks = materialize(readLines(path));
  const entry = [...tasks.open, ...tasks.done].find((t) => t.id === id);
  if (!entry) return false;
  appendEntry(
    path,
    taskLine(
      id,
      "task",
      jsonField("text", text) +
        ", " +
        jsonField("status", entry.status) +
        ", " +
        jsonField("source", entry.source) +
        ", " +
        jsonField("created", entry.created) +
        (entry.completed ? `, ${jsonField("completed", entry.completed)}` : ""),
    ),
  );
  return true;
}

export function removeTask(
  projectDir: string,
  id: string,
  reason: string,
): boolean {
  const path = resolveFile(projectDir);
  const tasks = materialize(readLines(path));
  const exists = [...tasks.open, ...tasks.done].some((t) => t.id === id);
  if (!exists) return false;
  appendEntry(
    path,
    taskLine(
      nextId(path),
      "task-tombstone",
      jsonField("target_id", id) +
        ", " +
        jsonField("reason", reason) +
        ", " +
        jsonField("created", currentTime()),
    ),
  );
  return true;
}

export function listTasks(projectDir: string): string {
  const path = resolveFile(projectDir);
  const tasks = materialize(readLines(path));
  return renderTaskList(tasks);
}

export function renderTaskList(tasks: MaterializedTasks): string {
  if (tasks.open.length === 0 && tasks.done.length === 0) {
    return "No tasks.";
  }
  const lines: string[] = [];
  if (tasks.open.length > 0) {
    lines.push("Open:");
    for (const t of tasks.open) {
      lines.push(`- [ ] [${t.id}] ${t.text}`);
    }
  }
  if (tasks.done.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Done:");
    for (const t of tasks.done) {
      lines.push(`- [x] [${t.id}] ${t.text}`);
    }
  }
  return lines.join("\n");
}

function appendEntry(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, content, "utf-8");
}

function nextId(path: string): string {
  const count = readLines(path).length;
  return `task-${count + 1}`;
}

function currentTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function taskLine(id: string, type: string, fieldsJson: string): string {
  return (
    "{" +
    jsonField("id", id) +
    ", " +
    jsonField("type", type) +
    ", " +
    fieldsJson +
    "}\n"
  );
}
