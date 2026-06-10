import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { extractField, jsonField } from "@mobrienv/autoloop-core";
import { readLines } from "@mobrienv/autoloop-core/journal";
import * as config from "./config.js";

export type TaskPriority = "high" | "normal" | "low";

export interface TaskEntry {
  id: string;
  type: "task" | "task-tombstone";
  text: string;
  status: "open" | "done";
  source: string;
  created: string;
  completed?: string;
  priority?: TaskPriority;
  soft?: boolean;
}

export interface AddTaskOpts {
  priority?: TaskPriority;
  soft?: boolean;
}

export function parsePriority(value: string): TaskPriority | undefined {
  if (value === "high" || value === "normal" || value === "low") return value;
  return undefined;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function priorityRank(priority: TaskPriority | undefined): number {
  return PRIORITY_RANK[priority ?? "normal"];
}

export interface MaterializedTasks {
  open: TaskEntry[];
  done: TaskEntry[];
}

export function resolveFile(projectDir: string): string {
  const envPath = process.env.AUTOLOOP_TASKS_FILE;
  if (envPath) return envPath;
  return config.resolveTasksFile(projectDir);
}

export function resolveFileIn(projectDir: string, workDir: string): string {
  const envPath = process.env.AUTOLOOP_TASKS_FILE;
  if (envPath) return envPath;
  return config.resolveTasksFileIn(projectDir, workDir);
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

  // Open: high → normal → low, oldest first (by creation) within a priority.
  // Done: most recent completion first.
  const openOldestFirst = open.reverse();
  return {
    open: openOldestFirst.sort(
      (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
    ),
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
    priority: parsePriority(extractField(line, "priority")),
    soft: extractField(line, "soft") === "true" ? true : undefined,
  };
}

// Serialize non-default priority/soft as a trailing field suffix so lines for
// default tasks stay byte-identical to the pre-priority format.
function priorityFields(
  priority: TaskPriority | undefined,
  soft: boolean | undefined,
): string {
  let suffix = "";
  if (priority && priority !== "normal") {
    suffix += `, ${jsonField("priority", priority)}`;
  }
  if (soft === true) {
    suffix += `, ${jsonField("soft", "true")}`;
  }
  return suffix;
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
  opts: AddTaskOpts = {},
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
        jsonField("created", currentTime()) +
        priorityFields(opts.priority, opts.soft),
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
        jsonField("completed", currentTime()) +
        priorityFields(entry.priority, entry.soft),
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
        (entry.completed
          ? `, ${jsonField("completed", entry.completed)}`
          : "") +
        priorityFields(entry.priority, entry.soft),
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

// "[high] text (soft)" — priority marker for non-normal priorities, plus a
// soft marker; plain text for default tasks (back-compat).
export function formatTaskText(t: TaskEntry): string {
  const prio = t.priority && t.priority !== "normal" ? `[${t.priority}] ` : "";
  const soft = t.soft === true ? " (soft)" : "";
  return `${prio}${t.text}${soft}`;
}

export function renderTaskList(tasks: MaterializedTasks): string {
  if (tasks.open.length === 0 && tasks.done.length === 0) {
    return "No tasks.";
  }
  const lines: string[] = [];
  if (tasks.open.length > 0) {
    lines.push("Open:");
    for (const t of tasks.open) {
      lines.push(`- [ ] [${t.id}] ${formatTaskText(t)}`);
    }
  }
  if (tasks.done.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Done:");
    for (const t of tasks.done) {
      lines.push(`- [x] [${t.id}] ${formatTaskText(t)}`);
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
