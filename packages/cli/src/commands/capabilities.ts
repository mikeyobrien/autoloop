// `autoloop capabilities` — machine-readable contract for agents.
//
// Prints a stable JSON document describing the command surface, structured
// output modes, exit-code dictionary, and environment variables, so an agent
// can read the contract from the tool itself instead of external docs.
// Output is JSON-only and deterministic (no timestamps, stable ordering).

import { createRequire } from "node:module";
import { JOURNAL_CONTRACT_VERSION } from "@mobrienv/autoloop-core";
import { EXIT_ENV, EXIT_OK, EXIT_USAGE } from "../cli/fail.js";

export const CONTRACT_VERSION = 1;

export interface CommandCapability {
  name: string;
  summary: string;
  json: boolean;
  mutating: boolean;
}

export function cliVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function commandCapabilities(): CommandCapability[] {
  return [
    {
      name: "run",
      summary: "Run a preset loop against a project",
      json: false,
      mutating: true,
    },
    {
      name: "init",
      summary: "Scaffold autoloops.toml in a project",
      json: false,
      mutating: true,
    },
    {
      name: "list",
      summary: "List bundled presets",
      json: true,
      mutating: false,
    },
    {
      name: "loops",
      summary: "List/show/watch runs; health summary",
      json: true,
      mutating: false,
    },
    {
      name: "triage",
      summary: "One-call status: runs + health + doctor + next commands",
      json: true,
      mutating: false,
    },
    {
      name: "inspect",
      summary: "Inspect run artifacts (scratchpad, journal, metrics, ...)",
      json: true,
      mutating: false,
    },
    {
      name: "stats",
      summary: "Cross-run analytics grouped by preset",
      json: true,
      mutating: false,
    },
    {
      name: "doctor",
      summary: "Environment and state diagnostics",
      json: true,
      mutating: false,
    },
    {
      name: "memory",
      summary: "Manage persistent project memory",
      json: false,
      mutating: true,
    },
    {
      name: "task",
      summary: "Manage the task queue",
      json: false,
      mutating: true,
    },
    {
      name: "chain",
      summary: "List or run preset chains",
      json: true,
      mutating: true,
    },
    {
      name: "emit",
      summary: "Emit a journal event",
      json: false,
      mutating: true,
    },
    {
      name: "control",
      summary: "Interrupt or guide a live run",
      json: false,
      mutating: true,
    },
    {
      name: "guide",
      summary: "Inject operator guidance into the next iteration",
      json: false,
      mutating: true,
    },
    {
      name: "worktree",
      summary: "List/show/diff/merge/clean run worktrees",
      json: false,
      mutating: true,
    },
    {
      name: "runs",
      summary: "Clean run-scoped state directories",
      json: false,
      mutating: true,
    },
    {
      name: "config",
      summary: "Show or edit resolved configuration",
      json: true,
      mutating: true,
    },
    {
      name: "dashboard",
      summary: "Serve the web dashboard",
      json: false,
      mutating: false,
    },
    {
      name: "kanban",
      summary: "Serve the kanban board",
      json: false,
      mutating: false,
    },
    {
      name: "capabilities",
      summary: "This contract document",
      json: true,
      mutating: false,
    },
    {
      name: "robot-docs",
      summary: "Paste-ready agent handbook",
      json: false,
      mutating: false,
    },
  ];
}

export function capabilitiesJson(): string {
  return JSON.stringify(
    {
      name: "autoloop",
      version: cliVersion(),
      contract_version: CONTRACT_VERSION,
      journal_contract_version: JOURNAL_CONTRACT_VERSION,
      exit_codes: {
        [String(EXIT_OK)]: "success",
        [String(EXIT_USAGE)]:
          "user-input error (unknown command/flag, missing argument, bad preset)",
        [String(EXIT_ENV)]:
          "environment/state error (missing backend, unwritable state dir)",
      },
      env: {
        AUTOLOOP_PROJECT_DIR:
          "project directory for state-reading commands (default: cwd)",
        AUTOLOOPS_BUNDLE_ROOT: "override the bundled-presets package root",
      },
      output_contract: {
        stdout: "requested data only",
        stderr: "diagnostics, warnings, and errors",
        json_flag:
          "--json on: list, loops, loops health, stats, doctor, chain run, config show, triage",
        events_stream:
          "run --events <path>: NDJSON LoopEvent stream (incl. progress + final loop.finish/summary)",
      },
      commands: commandCapabilities(),
    },
    null,
    2,
  );
}

export function dispatchCapabilities(args: string[]): void {
  // `--json` is accepted as a no-op alias: the surface is JSON-only.
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: autoloop capabilities [--json]");
    console.log("");
    console.log(
      "Print the machine-readable CLI contract: commands, structured-",
    );
    console.log(
      "output modes, exit-code dictionary, and environment variables.",
    );
    return;
  }
  console.log(capabilitiesJson());
}
