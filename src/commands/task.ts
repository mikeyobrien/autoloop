import * as tasks from "../tasks.js";
import { printTaskUsage } from "../usage.js";

export function dispatchTask(args: string[]): boolean {
  const sub = args[0] ?? "";

  switch (sub) {
    case "add": {
      const text = args.slice(1).join(" ");
      if (!text || text === "--help") {
        console.log("Usage: autoloop task add <text...>");
        return true;
      }
      const id = tasks.addTask(resolveRuntimeProjectDir(), text, "manual");
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

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
