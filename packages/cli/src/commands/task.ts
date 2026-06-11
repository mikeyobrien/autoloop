import * as tasks from "@mobrienv/autoloop-core/tasks";
import { printTaskUsage } from "../usage.js";

export function dispatchTask(args: string[]): boolean {
  const sub = args[0] ?? "";

  switch (sub) {
    case "add": {
      const parsed = parseAddArgs(args.slice(1));
      if (!parsed || parsed.help) {
        console.log(
          "Usage: autoloop task add [--priority|-p <high|normal|low>] [--soft] <text...>",
        );
        return true;
      }
      const id = tasks.addTask(
        resolveRuntimeProjectDir(),
        parsed.text,
        "manual",
        {
          priority: parsed.priority,
          soft: parsed.soft,
        },
      );
      console.log(id);
      return true;
    }
    case "complete": {
      const id = args[1];
      if (!id || id === "--help") {
        console.log("Usage: autoloop task complete <id>");
        return true;
      }
      const ok = tasks.completeTask(resolveRuntimeProjectDir(), id);
      if (ok) {
        console.log(`completed ${id}`);
      } else {
        console.log(`warning: no open task with ID ${id} found`);
      }
      return true;
    }
    case "update": {
      const id = args[1];
      const text = args.slice(2).join(" ");
      if (!id || !text || id === "--help") {
        console.log("Usage: autoloop task update <id> <text...>");
        return true;
      }
      const ok = tasks.updateTask(resolveRuntimeProjectDir(), id, text);
      if (ok) {
        console.log(`updated ${id}`);
      } else {
        console.log(`warning: no task with ID ${id} found`);
      }
      return true;
    }
    case "remove": {
      const id = args[1];
      if (!id || id === "--help") {
        console.log("Usage: autoloop task remove <id> [reason...]");
        return true;
      }
      const reason = args.slice(2).join(" ") || "manual";
      const ok = tasks.removeTask(resolveRuntimeProjectDir(), id, reason);
      if (ok) {
        console.log(`removed ${id}`);
      } else {
        console.log(`warning: no task with ID ${id} found`);
      }
      return true;
    }
    case "list":
      console.log(tasks.listTasks(args[1] ?? resolveRuntimeProjectDir()));
      return true;
    default:
      printTaskUsage();
      return true;
  }
}

interface ParsedAdd {
  text: string;
  priority?: tasks.TaskPriority;
  soft: boolean;
  help: boolean;
}

// Returns undefined on invalid input (missing text, bad/missing priority value).
function parseAddArgs(args: string[]): ParsedAdd | undefined {
  let priority: tasks.TaskPriority | undefined;
  let soft = false;
  let help = false;
  const textParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--soft") {
      soft = true;
      continue;
    }
    if (arg === "--priority" || arg === "-p") {
      i += 1;
      const value = tasks.parsePriority(args[i] ?? "");
      if (!value) return undefined;
      priority = value;
      continue;
    }
    textParts.push(arg);
  }

  const text = textParts.join(" ");
  if (!text && !help) return undefined;
  return { text, priority, soft, help };
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
