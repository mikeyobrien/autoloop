import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRunByPrefix } from "@mobrienv/autoloop-core/registry/read";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import * as harness from "@mobrienv/autoloop-harness";
import { cliPrintEvent } from "../cli/event-printer.js";
import { EXIT_ENV, EXIT_USAGE, fail } from "../cli/fail.js";
import { backendOverrideSpec } from "./run.js";

interface ResumeArgs {
  runId: string | null;
  addIterations?: number;
  backendOverride?: Record<string, unknown>;
  logLevel: string | null;
  usageError: boolean;
  /** Force every fan-out stage branch to relaunch rather than resume. */
  noResume?: boolean;
}

export async function dispatchResume(args: string[]): Promise<void> {
  if (args.some((a) => a === "--help" || a === "-h")) {
    printResumeUsage();
    return;
  }

  const parsed = parseResumeArgs(args);
  if (parsed.usageError) return;
  if (!parsed.runId) {
    fail(
      [
        "error: missing required run-id",
        "Usage: autoloop resume <run-id> [--add-iterations N] [-b <backend>] [-v]",
      ],
      EXIT_USAGE,
    );
    return;
  }

  const projectDir = process.env.AUTOLOOP_PROJECT_DIR || ".";
  const stateDir = join(projectDir, ".autoloop");
  const registryFile = join(stateDir, "registry.jsonl");

  const lookup = findRunByPrefix(registryFile, parsed.runId);
  if (!lookup) {
    fail(
      [
        `error: no run matching \`${parsed.runId}\``,
        "Run `autoloop loops --all` to list runs.",
      ],
      EXIT_ENV,
    );
    return;
  }
  if (Array.isArray(lookup)) {
    fail(
      [
        `error: \`${parsed.runId}\` is ambiguous (${lookup.length} matches):`,
        ...lookup.map((r) => `  ${r.run_id}`),
        "Provide a longer prefix.",
      ],
      EXIT_USAGE,
    );
    return;
  }

  const record = lookup;
  const validation = validateResumable(record, parsed);
  if (validation) {
    fail([validation.message], validation.code);
    return;
  }

  // Mirror dispatchRun's signal ownership: CLI installs SIGINT/SIGTERM, aborts
  // the harness via AbortSignal, and re-raises the signal on exit.
  const abort = new AbortController();
  let caughtSignal: NodeJS.Signals | null = null;
  const onSig = (sig: NodeJS.Signals) => {
    if (caughtSignal) return;
    caughtSignal = sig;
    abort.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    const result = await harness.resume(record, {
      addIterations: parsed.addIterations,
      backendOverride: parsed.backendOverride,
      logLevel: parsed.logLevel,
      baseStateDir: stateDir,
      signal: abort.signal,
      onEvent: cliPrintEvent,
      noResume: parsed.noResume,
    });
    console.log(
      `resumed ${record.run_id} from iteration ${result.resumedFromIteration} ` +
        `(was: ${record.stop_reason || "unknown"}); ` +
        `stop_reason=${result.stopReason} iterations=${result.iterations} ` +
        `new_max_iterations=${result.newMaxIterations}`,
    );
  } finally {
    process.removeListener("SIGINT", onSig);
    process.removeListener("SIGTERM", onSig);
    if (caughtSignal) process.kill(process.pid, caughtSignal);
  }
}

interface Validation {
  message: string;
  code: number;
}

/** Returns a validation failure, or null when the run is safe to resume. */
function validateResumable(
  record: RunRecord,
  parsed: ResumeArgs,
): Validation | null {
  if (record.status === "completed") {
    return {
      message: `error: run ${record.run_id} already completed; cannot resume`,
      code: EXIT_ENV,
    };
  }
  if (record.status === "running" && record.pid && pidAlive(record.pid)) {
    return {
      message: `error: run ${record.run_id} is still running (PID ${record.pid})`,
      code: EXIT_ENV,
    };
  }
  if (!record.journal_file || !existsSync(record.journal_file)) {
    return {
      message: `error: journal not found for run ${record.run_id}`,
      code: EXIT_ENV,
    };
  }
  const stateDir = record.state_dir || dirOf(record.journal_file);
  if (!stateDir || !existsSync(stateDir)) {
    return {
      message: `error: state directory for run ${record.run_id} not found`,
      code: EXIT_ENV,
    };
  }
  if (record.isolation_mode === "worktree") {
    if (!record.worktree_path || !existsSync(record.worktree_path)) {
      return {
        message: `error: worktree for run ${record.run_id} was cleaned up; cannot resume`,
        code: EXIT_ENV,
      };
    }
  }
  if (parsed.addIterations !== undefined && parsed.addIterations <= 0) {
    return {
      message: "error: no iterations to run (--add-iterations must be > 0)",
      code: EXIT_USAGE,
    };
  }
  return null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "";
}

function parseResumeArgs(args: string[]): ResumeArgs {
  const out: ResumeArgs = {
    runId: null,
    logLevel: null,
    usageError: false,
  };

  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (token === "resume") {
      i++;
      continue;
    }
    if (token === "-v" || token === "--verbose") {
      out.logLevel = "debug";
      i++;
      continue;
    }
    if (token === "--add-iterations") {
      const value = args[i + 1];
      if (value === undefined) {
        fail(`missing count after ${token}`, EXIT_USAGE);
        out.usageError = true;
        return out;
      }
      const n = Number(value);
      if (!Number.isInteger(n)) {
        fail(`invalid --add-iterations value: ${value}`, EXIT_USAGE);
        out.usageError = true;
        return out;
      }
      out.addIterations = n;
      i += 2;
      continue;
    }
    if (token === "-b" || token === "--backend") {
      const backend = args[i + 1];
      if (!backend) {
        fail(`missing backend after ${token}`, EXIT_USAGE);
        out.usageError = true;
        return out;
      }
      out.backendOverride = backendOverrideSpec(backend);
      i += 2;
      continue;
    }
    if (token === "--no-resume") {
      out.noResume = true;
      i++;
      continue;
    }
    if (out.runId === null && !token.startsWith("-")) {
      out.runId = token;
      i++;
      continue;
    }
    i++;
  }

  return out;
}

export function printResumeUsage(): void {
  console.log(
    "Usage: autoloop resume <run-id> [--add-iterations N] [-b <backend>] [-v]",
  );
  console.log("");
  console.log(
    "Continue a previously-terminated run from where it left off, reusing the",
  );
  console.log("run_id, journal, memory, working files, and worktree.");
  console.log("");
  console.log("Flags:");
  console.log(
    "  --add-iterations N    Iterations to grant beyond the resume point",
  );
  console.log(
    "                        (default: the run's original max_iterations)",
  );
  console.log(
    "  -b, --backend <name>  Resume with a different backend (claude-sdk, pi, ...)",
  );
  console.log(
    "  --no-resume           Relaunch every fan-out stage branch instead of",
  );
  console.log(
    "                        reusing journaled branch results from a prior attempt",
  );
  console.log("  -v, --verbose         Set log level to debug");
  console.log("  -h, --help            Show this help");
  console.log("");
  console.log("The <run-id> may be a full id or any unambiguous prefix.");
}
