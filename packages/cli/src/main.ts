import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import * as harness from "@mobrienv/autoloop-harness";
import * as chains from "./chains.js";
import { cliPrintEvent } from "./cli/event-printer.js";
import { fail } from "./cli/fail.js";
import { editDistance, suggestClosest } from "./cli/suggest.js";
import { dispatchAcp } from "./commands/acp.js";
import { cliVersion, dispatchCapabilities } from "./commands/capabilities.js";
import { dispatchChain } from "./commands/chain.js";
import { dispatchConfig } from "./commands/config.js";
import { dispatchControl } from "./commands/control.js";
import { dispatchDashboard } from "./commands/dashboard.js";
import { dispatchDoctor } from "./commands/doctor.js";
import { dispatchGuide } from "./commands/guide.js";
import { dispatchHooks } from "./commands/hooks.js";
import { dispatchInit } from "./commands/init.js";
import { dispatchInspect } from "./commands/inspect.js";
import { dispatchKanban } from "./commands/kanban.js";
import { dispatchList } from "./commands/list.js";
import { dispatchLoops } from "./commands/loops.js";
import { dispatchMemory } from "./commands/memory.js";
import { dispatchPiAdapter } from "./commands/pi-adapter.js";
import { dispatchPreset } from "./commands/preset.js";
import { dispatchResume } from "./commands/resume.js";
import { dispatchRobotDocs } from "./commands/robot-docs.js";
import { dispatchRun } from "./commands/run.js";
import { dispatchRuns } from "./commands/runs.js";
import { dispatchStats } from "./commands/stats.js";
import { dispatchTask } from "./commands/task.js";
import { dispatchTriage } from "./commands/triage.js";
import { dispatchVerify } from "./commands/verify.js";
import { dispatchWorktree } from "./commands/worktree.js";
import { printEmitUsage, printUsage } from "./usage.js";

async function main(): Promise<void> {
  const argv = process.argv;
  const args = runtimeArgv(argv);
  await dispatch(args, argv);
}

async function dispatch(args: string[], argv: string[]): Promise<void> {
  const cmd = args[0] ?? "";
  const selfCmd = selfCommand(argv);
  const bundleRoot = resolveBundleRoot(argv);

  switch (cmd) {
    case "":
      // Bare invocation: show the full usage instead of a run error so the
      // first thing an agent tries produces something useful.
      printUsage();
      return;
    case "--help":
    case "-h":
      printUsage();
      return;
    case "help":
      // `autoloop help <cmd>` re-dispatches as `<cmd> --help`.
      if (args[1] && args[1] !== "help") {
        await dispatch([args[1], "--help"], argv);
        return;
      }
      printUsage();
      return;
    case "--version":
    case "-V":
    case "version":
      console.log(cliVersion());
      return;
    case "capabilities":
      dispatchCapabilities(args.slice(1));
      return;
    case "robot-docs":
      dispatchRobotDocs(args.slice(1));
      return;
    case "triage":
      dispatchTriage(args.slice(1));
      return;
    case "run":
      await dispatchRun(args.slice(1), argv, bundleRoot, selfCmd);
      return;
    case "resume":
      await dispatchResume(args.slice(1));
      return;
    case "emit": {
      if (!args[1] || args[1] === "--help" || args[1] === "-h") {
        printEmitUsage();
        return;
      }
      const emitResult = harness.emit(
        resolveRuntimeProjectDir(),
        args[1],
        args.slice(2).join(" "),
      );
      if (emitResult.ok) {
        process.stdout.write(`emitted ${emitResult.topic}\n`);
        process.exitCode = 0;
      } else {
        if (emitResult.error) process.stderr.write(`${emitResult.error}\n`);
        process.exitCode = 1;
      }
      return;
    }
    case "list":
      dispatchList(args.slice(1), bundleRoot);
      return;
    case "loops":
      dispatchLoops(args.slice(1));
      return;
    case "inspect":
      dispatchInspect(args.slice(1));
      return;
    case "preset":
      dispatchPreset(args.slice(1));
      return;
    case "pi-adapter":
      dispatchPiAdapter(args.slice(1));
      return;
    case "branch-run":
      await harness.runParallelBranchCli(
        args[1],
        args[2],
        selfCmd,
        cliPrintEvent,
      );
      return;
    case "memory":
      dispatchMemory(args.slice(1));
      return;
    case "task":
      dispatchTask(args.slice(1));
      return;
    case "worktree":
      dispatchWorktree(args.slice(1));
      return;
    case "runs":
      dispatchRuns(args.slice(1));
      return;
    case "stats":
      dispatchStats(args.slice(1));
      return;
    case "verify":
      dispatchVerify(args.slice(1));
      return;
    case "doctor":
      dispatchDoctor(args.slice(1));
      return;
    case "init":
      dispatchInit(args.slice(1));
      return;
    case "chain":
      await dispatchChain(args.slice(1), selfCmd);
      return;
    case "config":
      dispatchConfig(args.slice(1));
      return;
    case "guide":
      dispatchGuide(args.slice(1));
      return;
    case "hooks":
      dispatchHooks(args.slice(1));
      return;
    case "control":
      dispatchControl(args.slice(1));
      return;
    case "dashboard":
      dispatchDashboard(args.slice(1), bundleRoot, selfCmd);
      return;
    case "acp":
      await dispatchAcp(args.slice(1), bundleRoot, selfCmd);
      return;
    case "kanban":
      dispatchKanban(args.slice(1), bundleRoot, selfCmd);
      return;
    default: {
      // `autoloop <preset>` is shorthand for `autoloop run <preset>` — but a
      // mistyped command must never be silently treated as a preset. When
      // the word is not a real preset or directory and is a near-miss of a
      // command name, fail fast with the correction instead.
      const typo = commandTypo(cmd);
      if (typo) {
        fail([
          `error: unknown command \`${cmd}\``,
          `Did you mean \`autoloop ${typo}\`?`,
          "Run `autoloop --help` to see all commands.",
        ]);
        return;
      }
      await dispatchRun(args, argv, bundleRoot, selfCmd);
    }
  }
}

/**
 * Return the closest command name when `word` looks like a mistyped command
 * (within edit distance 2) rather than a preset or directory, else null.
 */
function commandTypo(word: string): string | null {
  if (word.startsWith("-")) return null;
  if (existsSync(word)) return null;
  if (chains.listKnownPresets().includes(word)) return null;
  const suggestion = suggestClosest(word, CLI_COMMANDS);
  if (!suggestion) return null;
  if (suggestion.toLowerCase().startsWith(word.toLowerCase()))
    return suggestion;
  return editDistance(word.toLowerCase(), suggestion) <= 2 ? suggestion : null;
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function runtimeArgv(argv: string[]): string[] {
  // argv[0] is node, argv[1] is script, rest is user args
  const userArgs = argv.slice(2);
  if (userArgs.length === 0) return [];

  // If first arg is a CLI command, use as-is
  if (isCliCommand(userArgs[0])) return userArgs;

  // For "autoloop run <project>" form, pass through
  if (userArgs[0] === "run" && userArgs.length >= 2) {
    return userArgs;
  }

  return userArgs;
}

const CLI_COMMANDS = [
  "run",
  "resume",
  "emit",
  "inspect",
  "memory",
  "task",
  "list",
  "loops",
  "runs",
  "stats",
  "doctor",
  "triage",
  "init",
  "chain",
  "pi-adapter",
  "branch-run",
  "worktree",
  "config",
  "guide",
  "hooks",
  "control",
  "dashboard",
  "kanban",
  "capabilities",
  "robot-docs",
  "acp",
  "help",
  "version",
];

function isCliCommand(value: string): boolean {
  return [...CLI_COMMANDS, "--help", "-h", "--version", "-V"].includes(value);
}

function selfCommand(argv: string[]): string {
  // Return a command that re-invokes this program. Always go through the
  // running Node interpreter: argv[1] is the npm bin shim (shebang'd) on
  // installed copies but a bare ESM file when driven as
  // `node packages/cli/dist/main.js` from a checkout — exec'ing that
  // directly makes /bin/sh interpret JavaScript (its `import` lines even
  // resolve to ImageMagick's import(1)), silently breaking every generated
  // tool wrapper and with it agent event emission.
  const entry = argv[1];
  if (!entry) return "autoloop";
  // Single-binary builds (bun build --compile, Node SEA): execPath IS the
  // CLI and argv[1] is a virtual bundle path (e.g. /$bunfs/...) that must
  // not be passed back as an argument — re-invoke the binary bare.
  const execBase = basename(process.execPath);
  if (execBase !== "node" && !execBase.startsWith("node.")) {
    return `'${process.execPath}'`;
  }
  return `'${process.execPath}' '${resolve(entry)}'`;
}

function resolveBundleRoot(argv: string[]): string {
  const envRoot = process.env.AUTOLOOPS_BUNDLE_ROOT;
  if (envRoot) return envRoot;
  // Locate the @mobrienv/autoloop-presets package root via node resolution.
  // This works in every topology: source checkout (workspace symlink),
  // published install under node_modules, global install, etc. The
  // presets/ dir ships inside that package; bundleRoot is its parent so
  // downstream `join(bundleRoot, "presets/<name>")` still resolves.
  const require = createRequire(import.meta.url);
  try {
    const pkgPath = require.resolve("@mobrienv/autoloop-presets/package.json");
    return dirname(pkgPath);
  } catch {
    // Back-compat: older installs bundled presets directly inside the
    // @mobrienv/autoloop package root.
    try {
      const pkgPath = require.resolve("@mobrienv/autoloop/package.json");
      return dirname(pkgPath);
    } catch {
      // Last-resort argv[1] heuristic for unusual invocations where package
      // resolution fails (e.g. running dist directly out-of-tree).
      const scriptPath = argv[1] ?? "";
      if (scriptPath) {
        const scriptDir = resolve(scriptPath, "..");
        const argvCandidate = resolve(scriptDir, "..");
        if (existsSync(join(argvCandidate, "presets"))) return argvCandidate;
      }
      return ".";
    }
  }
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? err.stack || err.message : String(err)}\n`,
  );
  process.exit(1);
});
