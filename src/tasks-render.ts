import { lineSep } from "@mobrienv/autoloop-core";
import type { MaterializedTasks } from "./tasks.js";

export function renderTasksPrompt(
  tasks: MaterializedTasks,
  budgetChars: number,
): string {
  if (tasks.open.length === 0 && tasks.done.length === 0) return "";

  const lines: string[] = ["Tasks:"];

  if (tasks.open.length > 0) {
    lines.push("Open:");
    for (const t of tasks.open) {
      lines.push(`- [ ] [${t.id}] ${t.text}`);
    }
  }

  if (tasks.done.length > 0) {
    lines.push("Done:");
    for (const t of tasks.done) {
      lines.push(`- [x] [${t.id}] ${t.text} (done)`);
    }
  }

  const text = lines.join(lineSep()) + lineSep();
  return truncateTasksText(text, budgetChars, tasks);
}

function truncateTasksText(
  text: string,
  budgetChars: number,
  tasks: MaterializedTasks,
): string {
  if (budgetChars <= 0) return text;
  if (text.length <= budgetChars) return text;

  // Drop done tasks first, then oldest open tasks
  const lines = text.split(lineSep());
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (used + lineLen > budgetChars) break;
    kept.push(line);
    used += lineLen;
  }

  const totalEntries = tasks.open.length + tasks.done.length;
  const keptEntries = kept.filter((l) => l.startsWith("- ")).length;
  const dropped = totalEntries - keptEntries;

  return (
    kept.join(lineSep()) +
    "\n...\n" +
    `(tasks truncated: ${dropped} entries dropped — ${text.length}/${budgetChars} chars)`
  );
}
