import { join } from "node:path";
import {
  appendRequest,
  buildRequest,
  pendingRequests,
  readCapabilities,
  readStatuses,
  renderCapabilities,
  renderShow,
  supportsInterrupt,
} from "../control/index.js";
import type { ControlSnapshot } from "../control/render.js";
import type { ControlRequest, GuidePayload } from "../control/types.js";
import { appendOperatorEvent } from "../harness/journal.js";
import { mergedFindRunByPrefix } from "../registry/discover.js";
import type { RunRecord } from "../registry/types.js";

export function dispatchControl(args: string[]): void {
  const sub = args[0] ?? "";
  if (sub === "" || sub === "--help" || sub === "-h") {
    printUsage();
    return;
  }

  const projectDir = resolveProjectDir();
  const stateDir = join(projectDir, ".autoloop");

  if (sub === "show") {
    handleShow(stateDir, args.slice(1));
    return;
  }
  if (sub === "capabilities" || sub === "caps") {
    handleCapabilities(stateDir, args.slice(1));
    return;
  }
  if (sub === "interrupt") {
    handleInterrupt(stateDir, args.slice(1));
    return;
  }
  if (sub === "guide") {
    handleGuide(stateDir, args.slice(1));
    return;
  }

  console.log(`Unknown control subcommand: ${sub}`);
  printUsage();
  process.exitCode = 1;
}

function resolveProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function resolveRun(
  stateDir: string,
  partial: string,
): RunRecord | { error: string } {
  const result = mergedFindRunByPrefix(stateDir, partial);
  if (result === undefined) return { error: `No run matching '${partial}'.` };
  if (Array.isArray(result)) {
    const ids = result.map((r) => `  ${r.run_id}`).join("\n");
    return { error: `Ambiguous run ID '${partial}'. Matches:\n${ids}` };
  }
  return result;
}

function runStateDir(run: RunRecord): string {
  if (run.state_dir) return run.state_dir;
  // Legacy/derived records without state_dir: fall back to <work>/.autoloop
  return join(run.work_dir || ".", ".autoloop");
}

function buildSnapshot(run: RunRecord): ControlSnapshot {
  const dir = runStateDir(run);
  return {
    run,
    capabilities: readCapabilities(dir),
    pendingRequests: pendingRequests(dir),
    recentStatuses: readStatuses(dir),
  };
}

function handleShow(stateDir: string, args: string[]): void {
  const partial = args[0];
  if (!partial) {
    console.log("Usage: autoloop control show <run-id>");
    process.exitCode = 1;
    return;
  }
  const res = resolveRun(stateDir, partial);
  if ("error" in res) {
    console.log(res.error);
    process.exitCode = 1;
    return;
  }
  console.log(renderShow(buildSnapshot(res)));
}

function handleCapabilities(stateDir: string, args: string[]): void {
  const partial = args[0];
  if (!partial) {
    console.log("Usage: autoloop control capabilities <run-id>");
    process.exitCode = 1;
    return;
  }
  const res = resolveRun(stateDir, partial);
  if ("error" in res) {
    console.log(res.error);
    process.exitCode = 1;
    return;
  }
  const caps = readCapabilities(runStateDir(res));
  console.log(renderCapabilities(caps));
}

function handleInterrupt(stateDir: string, args: string[]): void {
  const { runArg, reason } = parseReason(args);
  if (!runArg) {
    console.log("Usage: autoloop control interrupt <run-id> [-m <reason>]");
    process.exitCode = 1;
    return;
  }
  const res = resolveRun(stateDir, runArg);
  if ("error" in res) {
    console.log(res.error);
    process.exitCode = 1;
    return;
  }
  const dir = runStateDir(res);
  const caps = readCapabilities(dir);
  const request = buildRequest(res.run_id, "interrupt", {}, reason);
  appendRequest(dir, request);

  pokeParent(res);

  if (supportsInterrupt(caps)) {
    console.log(
      `Interrupt requested for ${res.run_id} (backend: ${caps?.backend ?? "unknown"}).`,
    );
  } else {
    console.log(
      `Interrupt request queued for ${res.run_id} — backend capability: ${describeInterrupt(caps)}.`,
    );
  }
}

function handleGuide(stateDir: string, args: string[]): void {
  let runArg = "";
  let noInterrupt = false;
  const messageParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-interrupt") {
      noInterrupt = true;
    } else if (a === "--run" && args[i + 1]) {
      runArg = args[++i];
    } else if (!runArg) {
      runArg = a;
    } else {
      messageParts.push(a);
    }
  }
  const message = messageParts.join(" ").trim();
  if (!runArg || !message) {
    console.log(
      'Usage: autoloop control guide <run-id> "<message>" [--no-interrupt]',
    );
    process.exitCode = 1;
    return;
  }

  const res = resolveRun(stateDir, runArg);
  if ("error" in res) {
    console.log(res.error);
    process.exitCode = 1;
    return;
  }

  const dir = runStateDir(res);
  const caps = readCapabilities(dir);
  const wantInterrupt = !noInterrupt;

  // Guidance is always durable via the journal — this is the canonical path
  // and is what the next iteration actually reads.
  if (res.journal_file) {
    appendOperatorEvent(
      res.journal_file,
      res.run_id,
      "",
      "operator.guidance",
      message,
    );
  }

  const payload: GuidePayload = { message, interrupt: wantInterrupt };
  const request: ControlRequest = buildRequest(
    res.run_id,
    "guide",
    payload,
    "guide",
  );
  appendRequest(dir, request);

  if (wantInterrupt) {
    pokeParent(res);
  }

  const interruptNote = !wantInterrupt
    ? "(interrupt skipped by --no-interrupt)"
    : supportsInterrupt(caps)
      ? `(interrupt requested — ${caps?.backend ?? "backend"} will cancel current turn)`
      : `(interrupt not supported by backend: ${describeInterrupt(caps)})`;

  console.log(`Guidance queued for ${res.run_id} ${interruptNote}.`);
}

function parseReason(args: string[]): { runArg: string; reason: string } {
  let runArg = "";
  let reason = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m" && args[i + 1] !== undefined) {
      reason = args[++i];
      continue;
    }
    if (args[i] === "--reason" && args[i + 1] !== undefined) {
      reason = args[++i];
      continue;
    }
    if (!runArg) runArg = args[i];
  }
  return { runArg, reason };
}

function describeInterrupt(caps: ReturnType<typeof readCapabilities>): string {
  if (!caps) return "no capabilities published";
  if (caps.interrupt.supported) return "supported";
  return caps.interrupt.detail || "not supported";
}

function pokeParent(run: RunRecord): void {
  if (!run.pid) return;
  if (run.status !== "running") return;
  try {
    process.kill(run.pid, "SIGUSR1");
  } catch {
    /* parent may have exited; file-backed request remains durable */
  }
}

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  autoloop control show <run-id>               Show status + capabilities",
  );
  console.log(
    "  autoloop control capabilities <run-id>       Show backend capabilities only",
  );
  console.log("  autoloop control interrupt <run-id> [-m <reason>]");
  console.log('  autoloop control guide <run-id> "<message>" [--no-interrupt]');
}
