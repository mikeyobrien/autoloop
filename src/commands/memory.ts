import * as memory from "../memory.js";
import { printMemoryAddUsage, printMemoryUsage } from "../usage.js";

export function dispatchMemory(args: string[]): boolean {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list":
      console.log(memory.listProject(args[1] ?? resolveRuntimeProjectDir()));
      return true;
    case "status":
      console.log(memory.statusProject(args[1] ?? resolveRuntimeProjectDir()));
      return true;
    case "find":
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory find <pattern...>");
        return true;
      }
      console.log(
        memory.findProject(resolveRuntimeProjectDir(), args.slice(1).join(" ")),
      );
      return true;
    case "add":
      dispatchMemoryAdd(args.slice(1));
      return true;
    case "remove":
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory remove <id> [reason...]");
        return true;
      }
      memory.remove(
        resolveRuntimeProjectDir(),
        args[1],
        args.slice(2).join(" ") || "manual",
      );
      return true;
    default:
      printMemoryUsage();
      return true;
  }
}

function dispatchMemoryAdd(args: string[]): void {
  const kind = args[0] ?? "";

  switch (kind) {
    case "learning":
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory add learning <text...>");
        return;
      }
      memory.addLearning(
        resolveRuntimeProjectDir(),
        args.slice(1).join(" "),
        "manual",
      );
      return;
    case "preference":
      if (!args[1] || args[1] === "--help") {
        console.log(
          "Usage: autoloop memory add preference <category> <text...>",
        );
        return;
      }
      memory.addPreference(
        resolveRuntimeProjectDir(),
        args[1],
        args.slice(2).join(" "),
      );
      return;
    case "meta":
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory add meta <key> <value...>");
        return;
      }
      memory.addMeta(
        resolveRuntimeProjectDir(),
        args[1],
        args.slice(2).join(" "),
      );
      return;
    default:
      printMemoryAddUsage();
  }
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
