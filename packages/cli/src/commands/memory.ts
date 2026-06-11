import * as memory from "@mobrienv/autoloop-core/memory";
import { printMemoryAddUsage, printMemoryUsage } from "../usage.js";

export function dispatchMemory(args: string[]): boolean {
  const sub = args[0] ?? "";

  switch (sub) {
    case "list": {
      const stateDir = resolveRuntimeStateDir();
      if (stateDir) {
        console.log(
          memory.renderTwoTier(
            memory.resolveFile(resolveRuntimeProjectDir()),
            memory.resolveRunFile(stateDir),
            0,
          ),
        );
      } else {
        console.log(memory.listProject(args[1] ?? resolveRuntimeProjectDir()));
      }
      return true;
    }
    case "status": {
      const stateDir = resolveRuntimeStateDir();
      if (stateDir) {
        const stats = memory.statsTwoTier(
          memory.resolveFile(resolveRuntimeProjectDir()),
          memory.resolveRunFile(stateDir),
          0,
        );
        const p = stats.project;
        const r = stats.run;
        const total =
          p.preferences.length +
          p.learnings.length +
          p.meta.length +
          r.preferences.length +
          r.learnings.length +
          r.meta.length;
        console.log(
          `Memory: ${stats.combinedRenderedChars} chars rendered. ${total} entries active (project: ${p.preferences.length} prefs, ${p.learnings.length} learnings, ${p.meta.length} meta; run: ${r.learnings.length} learnings, ${r.meta.length} meta).`,
        );
      } else {
        console.log(
          memory.statusProject(args[1] ?? resolveRuntimeProjectDir()),
        );
      }
      return true;
    }
    case "find": {
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory find <pattern...>");
        return true;
      }
      const pattern = args.slice(1).join(" ");
      const projResult = memory.findProject(
        resolveRuntimeProjectDir(),
        pattern,
      );
      const stateDir = resolveRuntimeStateDir();
      if (stateDir) {
        const runResult = memory.findInFile(
          memory.resolveRunFile(stateDir),
          pattern,
        );
        const parts = [projResult, runResult].filter(
          (r) => !r.startsWith("No active"),
        );
        console.log(parts.length > 0 ? parts.join("\n") : projResult);
      } else {
        console.log(projResult);
      }
      return true;
    }
    case "add":
      dispatchMemoryAdd(args.slice(1));
      return true;
    case "promote": {
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory promote <id>");
        return true;
      }
      const stateDir = resolveRuntimeStateDir();
      if (!stateDir) {
        console.log(
          "error: promote requires a run context (AUTOLOOP_STATE_DIR)",
        );
        return true;
      }
      memory.promote(resolveRuntimeProjectDir(), stateDir, args[1]);
      return true;
    }
    case "compact": {
      if (args[1] === "--help") {
        printMemoryCompactUsage();
        return true;
      }
      const projectDir = args[1] ?? resolveRuntimeProjectDir();
      const summary = memory.compactMemory(projectDir);
      if (summary.duplicatesRemoved === 0) {
        console.log(
          `Scanned ${summary.scanned} learnings; no duplicates found.`,
        );
      } else {
        console.log(
          `Scanned ${summary.scanned} learnings; tombstoned ${summary.duplicatesRemoved} duplicate(s):`,
        );
        for (const id of summary.ids) console.log(`  ${id}`);
      }
      return true;
    }
    case "prune": {
      const rest = args.slice(1);
      if (rest[0] === "--help") {
        printMemoryPruneUsage();
        return true;
      }
      const flagIndex = rest.indexOf("--max-age");
      if (flagIndex === -1) {
        console.log("error: prune requires --max-age <days>");
        printMemoryPruneUsage();
        return true;
      }
      const rawDays = rest[flagIndex + 1];
      const maxAgeDays = Number(rawDays);
      if (!rawDays || !Number.isInteger(maxAgeDays) || maxAgeDays <= 0) {
        console.log(
          `error: --max-age must be a positive integer number of days (got: ${rawDays ?? "nothing"})`,
        );
        return true;
      }
      const positional = rest.filter(
        (_, i) => i !== flagIndex && i !== flagIndex + 1,
      );
      const projectDir = positional[0] ?? resolveRuntimeProjectDir();
      const summary = memory.pruneMemory(projectDir, maxAgeDays);
      if (summary.pruned === 0) {
        console.log(
          `Scanned ${summary.scanned} learnings; none older than ${maxAgeDays} days.`,
        );
      } else {
        console.log(
          `Scanned ${summary.scanned} learnings; tombstoned ${summary.pruned} older than ${maxAgeDays} days:`,
        );
        for (const id of summary.ids) console.log(`  ${id}`);
      }
      return true;
    }
    case "remove": {
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory remove <id> [reason...]");
        return true;
      }
      const reason = args.slice(2).join(" ") || "manual";
      const stateDir = resolveRuntimeStateDir();
      if (stateDir) {
        memory.removeFromEither(
          resolveRuntimeProjectDir(),
          stateDir,
          args[1],
          reason,
        );
      } else {
        memory.remove(resolveRuntimeProjectDir(), args[1], reason);
      }
      return true;
    }
    default:
      printMemoryUsage();
      return true;
  }
}

function dispatchMemoryAdd(args: string[]): void {
  const kind = args[0] ?? "";

  switch (kind) {
    case "learning": {
      const isProject = args.includes("--project");
      const textArgs = args.slice(1).filter((a) => a !== "--project");
      if (!textArgs.length || textArgs[0] === "--help") {
        console.log(
          "Usage: autoloop memory add learning [--project] <text...>",
        );
        return;
      }
      const text = textArgs.join(" ");
      const stateDir = resolveRuntimeStateDir();
      if (isProject || !stateDir) {
        memory.addLearning(resolveRuntimeProjectDir(), text, "manual");
      } else {
        memory.addRunLearning(stateDir, text, "manual");
      }
      return;
    }
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
    case "meta": {
      if (!args[1] || args[1] === "--help") {
        console.log("Usage: autoloop memory add meta <key> <value...>");
        return;
      }
      const stateDir = resolveRuntimeStateDir();
      if (stateDir) {
        memory.addRunMeta(stateDir, args[1], args.slice(2).join(" "));
      } else {
        memory.addMeta(
          resolveRuntimeProjectDir(),
          args[1],
          args.slice(2).join(" "),
        );
      }
      return;
    }
    default:
      printMemoryAddUsage();
  }
}

function printMemoryCompactUsage(): void {
  console.log("Usage: autoloop memory compact [project-dir]");
  console.log("");
  console.log(
    "Tombstones duplicate learnings (same text after whitespace normalization), keeping the oldest entry of each group.",
  );
}

function printMemoryPruneUsage(): void {
  console.log("Usage: autoloop memory prune --max-age <days> [project-dir]");
  console.log("");
  console.log(
    "Tombstones learnings older than <days>. Preferences and meta entries are never pruned.",
  );
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function resolveRuntimeStateDir(): string | undefined {
  return process.env.AUTOLOOP_STATE_DIR || undefined;
}
