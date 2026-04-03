import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as config from "./config.js";
import { jsonField, extractField } from "./json.js";
import { bulletList } from "./markdown.js";
import { readIfExists, readLines } from "./harness/journal.js";
import { truncateText } from "./memory-render.js";
import type { MaterializedMemory } from "./memory-render.js";

interface MemoryStats {
  preferences: number;
  learnings: number;
  meta: number;
  totalEntries: number;
  renderedChars: number;
  budgetChars: number;
  truncated: boolean;
}

export function resolveFile(projectDir: string): string {
  const envPath = process.env["MINILOOPS_MEMORY_FILE"];
  if (envPath) return envPath;
  const cfg = config.loadProject(projectDir);
  return join(
    projectDir,
    config.get(cfg, "core.memory_file", ".autoloop/memory.jsonl"),
  );
}

export function renderProject(
  projectDir: string,
  budgetChars: number,
): string {
  return renderFile(resolveFile(projectDir), budgetChars);
}

export function renderFile(path: string, budgetChars: number): string {
  const memory = materialize(readLines(path));
  const text = renderMaterialized(memory);
  return truncateText(text, budgetChars, memory);
}

export function statsProject(
  projectDir: string,
  budgetChars: number,
): MemoryStats {
  return statsFile(resolveFile(projectDir), budgetChars);
}

export function statsFile(path: string, budgetChars: number): MemoryStats {
  const memory = materialize(readLines(path));
  return memoryStats(memory, budgetChars);
}

export function listProject(projectDir: string): string {
  return renderMaterialized(materialize(readLines(resolveFile(projectDir))));
}

export function rawProject(projectDir: string): string {
  return readIfExists(resolveFile(projectDir));
}

export function statusProject(projectDir: string): string {
  const stats = statsProject(projectDir, projectBudgetChars(projectDir));
  return formatStatus(stats);
}

export function findProject(projectDir: string, pattern: string): string {
  const memory = materialize(readLines(resolveFile(projectDir)));
  return renderMatches(findEntries(memory, pattern), pattern);
}

export function addLearning(
  projectDir: string,
  text: string,
  source: string,
): void {
  const path = resolveFile(projectDir);
  appendMemoryEntry(
    path,
    memoryLine(
      nextId(path, "mem"),
      "learning",
      jsonField("text", text) +
        ", " +
        jsonField("source", source) +
        ", " +
        jsonField("created", currentTime()),
    ),
  );
  console.log("stored learning");
  printBudgetWarning(projectDir);
}

export function addPreference(
  projectDir: string,
  category: string,
  text: string,
): void {
  const path = resolveFile(projectDir);
  appendMemoryEntry(
    path,
    memoryLine(
      nextId(path, "mem"),
      "preference",
      jsonField("category", category) +
        ", " +
        jsonField("text", text) +
        ", " +
        jsonField("created", currentTime()),
    ),
  );
  console.log("stored preference");
  printBudgetWarning(projectDir);
}

export function addMeta(
  projectDir: string,
  key: string,
  value: string,
): void {
  const path = resolveFile(projectDir);
  appendMemoryEntry(
    path,
    memoryLine(
      nextId(path, "meta"),
      "meta",
      jsonField("key", key) +
        ", " +
        jsonField("value", value) +
        ", " +
        jsonField("created", currentTime()),
    ),
  );
  console.log("stored meta");
  printBudgetWarning(projectDir);
}

export function remove(
  projectDir: string,
  id: string,
  reason: string,
): void {
  const path = resolveFile(projectDir);
  const memory = materialize(readLines(path));
  if (activeEntryExists(memory, id)) {
    removeExistingEntry(path, id, reason);
  } else {
    console.log("warning: no active entry with ID " + id + " found");
  }
}

function renderMaterialized(memory: MaterializedMemory): string {
  if (
    memory.preferences.length === 0 &&
    memory.learnings.length === 0 &&
    memory.meta.length === 0
  ) {
    return "";
  }
  return (
    "Loop memory:\n" +
    renderPreferences(memory.preferences) +
    renderLearnings(memory.learnings) +
    renderMeta(memory.meta)
  );
}

function renderPreferences(entries: string[]): string {
  if (entries.length === 0) return "";
  const items = entries.map(
    (e) =>
      "[" +
      extractField(e, "id") +
      "] [" +
      extractField(e, "category") +
      "] " +
      extractField(e, "text"),
  );
  return "Preferences:\n" + bulletList(items) + "\n";
}

function renderLearnings(entries: string[]): string {
  if (entries.length === 0) return "";
  const items = entries.map((e) => {
    const source = extractField(e, "source");
    const prefix = source ? "(" + source + ") " : "";
    return "[" + extractField(e, "id") + "] " + prefix + extractField(e, "text");
  });
  return "Learnings:\n" + bulletList(items) + "\n";
}

function renderMeta(entries: string[]): string {
  if (entries.length === 0) return "";
  const items = entries.map(
    (e) =>
      "[" +
      extractField(e, "id") +
      "] " +
      extractField(e, "key") +
      ": " +
      extractField(e, "value"),
  );
  return "Meta:\n" + bulletList(items) + "\n";
}

function memoryStats(
  memory: MaterializedMemory,
  budgetChars: number,
): MemoryStats {
  const renderedChars = renderMaterialized(memory).length;
  return {
    preferences: memory.preferences.length,
    learnings: memory.learnings.length,
    meta: memory.meta.length,
    totalEntries:
      memory.preferences.length +
      memory.learnings.length +
      memory.meta.length,
    renderedChars,
    budgetChars,
    truncated: budgetChars > 0 && renderedChars > budgetChars,
  };
}

function formatStatus(stats: MemoryStats): string {
  const budgetStr =
    stats.budgetChars <= 0
      ? "budget disabled"
      : stats.renderedChars > stats.budgetChars
        ? stats.budgetChars +
          " char budget (" +
          Math.floor(
            ((stats.renderedChars - stats.budgetChars) * 100) /
              stats.budgetChars,
          ) +
          "% over)"
        : stats.budgetChars +
          " char budget (" +
          Math.floor(
            (stats.renderedChars * 100) / stats.budgetChars,
          ) +
          "% used)";
  return (
    "Memory: " +
    stats.renderedChars +
    " chars rendered, " +
    budgetStr +
    ". " +
    stats.learnings +
    " learnings, " +
    stats.preferences +
    " preferences, " +
    stats.meta +
    " meta active."
  );
}

function printBudgetWarning(projectDir: string): void {
  const stats = statsProject(projectDir, projectBudgetChars(projectDir));
  if (stats.truncated) {
    console.log(
      "warning: memory is " +
        stats.renderedChars +
        "/" +
        stats.budgetChars +
        " chars rendered. This entry will be truncated from the agent prompt.",
    );
    console.log(
      "consider increasing memory.prompt_budget_chars or removing stale entries.",
    );
  }
}

function projectBudgetChars(projectDir: string): number {
  const cfg = config.loadProject(projectDir);
  return config.getInt(cfg, "memory.prompt_budget_chars", 8000);
}

function findEntries(
  memory: MaterializedMemory,
  pattern: string,
): string[] {
  const all = [
    ...memory.preferences,
    ...memory.learnings,
    ...memory.meta,
  ];
  return all.filter((entry) => entryMatches(entry, pattern));
}

function entryMatches(entry: string, pattern: string): boolean {
  const haystack = searchText(entry);
  return haystack.includes(pattern);
}

function searchText(entry: string): string {
  return [
    extractField(entry, "id"),
    extractField(entry, "category"),
    extractField(entry, "text"),
    extractField(entry, "source"),
    extractField(entry, "key"),
    extractField(entry, "value"),
  ].join(" ");
}

function renderMatches(entries: string[], pattern: string): string {
  if (entries.length === 0) {
    return "No active memory entries matching `" + pattern + "`.";
  }
  return entries.map(renderMatch).join("\n");
}

function renderMatch(entry: string): string {
  const id = extractField(entry, "id");
  const type = extractField(entry, "type");
  if (type === "preference") {
    return (
      id +
      ": preference [" +
      extractField(entry, "category") +
      "] " +
      extractField(entry, "text")
    );
  }
  if (type === "learning") {
    const source = extractField(entry, "source");
    const prefix = source ? "(" + source + ") " : "";
    return id + ": learning " + prefix + extractField(entry, "text");
  }
  if (type === "meta") {
    return (
      id +
      ": meta " +
      extractField(entry, "key") +
      ": " +
      extractField(entry, "value")
    );
  }
  return id + ": " + extractField(entry, "text");
}

function activeEntryExists(memory: MaterializedMemory, id: string): boolean {
  const all = [
    ...memory.preferences,
    ...memory.learnings,
    ...memory.meta,
  ];
  return all.some((entry) => extractField(entry, "id") === id);
}

function materialize(lines: string[]): MaterializedMemory {
  const reversed = [...lines].reverse();
  const seen: string[] = [];
  const tombstoned: string[] = [];
  const preferences: string[] = [];
  const learnings: string[] = [];
  const meta: string[] = [];
  const metaKeysSeen: string[] = [];

  for (const line of reversed) {
    const type = extractField(line, "type");
    const id = extractField(line, "id");

    if (type === "tombstone") {
      const targetId = extractField(line, "target_id");
      tombstoned.push(targetId);
      continue;
    }

    if (!id) continue;
    if (tombstoned.includes(id) || seen.includes(id)) continue;
    seen.push(id);

    if (type === "preference") {
      preferences.push(line);
    } else if (type === "learning") {
      learnings.push(line);
    } else if (type === "meta") {
      const key = extractField(line, "key");
      if (!metaKeysSeen.includes(key)) {
        metaKeysSeen.push(key);
        meta.push(line);
      }
    }
  }

  return {
    preferences: preferences.reverse(),
    learnings: learnings.reverse(),
    meta: meta.reverse(),
  };
}

function appendMemoryEntry(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path, content, "utf-8");
}

function nextId(path: string, prefix: string): string {
  const count = readLines(path).length;
  return prefix + "-" + (count + 1);
}

function removeExistingEntry(
  path: string,
  id: string,
  reason: string,
): void {
  appendMemoryEntry(
    path,
    memoryLine(nextId(path, "ts"), "tombstone", tombstoneFields(id, reason)),
  );
  console.log("removed " + id);
}

function currentTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function memoryLine(id: string, type: string, fieldsJson: string): string {
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

function tombstoneFields(id: string, reason: string): string {
  return (
    jsonField("target_id", id) +
    ", " +
    jsonField("reason", reason) +
    ", " +
    jsonField("created", currentTime())
  );
}

