// `autoloop doctor` — preflight and state-health diagnostics.
//
// Checks the environment (node, git, backend command) and the `.autoloop/`
// state tree (registry integrity, stale "running" runs, stale wave markers,
// orphaned worktrees) so operators — and agents — can diagnose a project in
// one command before or after a run. `--json` emits machine-readable results.

import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { MAX_TIMER_MS, parseDurationMs } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import { readRegistry } from "@mobrienv/autoloop-core/registry/read";
import { listWorktreeMetas } from "@mobrienv/autoloop-core/worktree";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export function dispatchDoctor(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    printDoctorUsage();
    return;
  }
  let json = false;
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else positionals.push(arg);
  }
  const projectDir = positionals[0] ?? resolveRuntimeProjectDir();
  const checks = runDoctorChecks(projectDir);
  if (json) {
    console.log(JSON.stringify({ projectDir, checks }, null, 2));
  } else {
    console.log(renderDoctorReport(projectDir, checks));
  }
  if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
}

export function runDoctorChecks(projectDir: string): DoctorCheck[] {
  const stateDir = join(projectDir, ".autoloop");
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push(checkGit(projectDir));
  checks.push(checkBackendCommand(projectDir));
  checks.push(checkRuntimeLimits(projectDir));
  checks.push(checkStateDir(stateDir));
  if (existsSync(stateDir)) {
    checks.push(checkRegistry(stateDir));
    checks.push(checkStaleRunningRuns(stateDir));
    checks.push(checkWaveMarker(stateDir));
    checks.push(checkOrphanWorktrees(stateDir));
  }
  return checks;
}

export function renderDoctorReport(
  projectDir: string,
  checks: DoctorCheck[],
): string {
  const lines: string[] = [`autoloop doctor — ${projectDir}`, ""];
  const nameWidth = Math.max(...checks.map((c) => c.name.length));
  for (const check of checks) {
    const icon =
      check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
    lines.push(`  ${icon} ${check.name.padEnd(nameWidth)}  ${check.detail}`);
  }
  const warns = checks.filter((c) => c.status === "warn").length;
  const fails = checks.filter((c) => c.status === "fail").length;
  lines.push("");
  lines.push(`${fails} failure(s), ${warns} warning(s)`);
  return lines.join("\n");
}

function checkNode(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 18) {
    return {
      name: "node",
      status: "ok",
      detail: `v${process.versions.node} (>= 18 required)`,
    };
  }
  return {
    name: "node",
    status: "fail",
    detail: `v${process.versions.node} is below the required Node 18`,
  };
}

function checkGit(projectDir: string): DoctorCheck {
  if (!commandOnPath("git")) {
    return {
      name: "git",
      status: "warn",
      detail: "git not found on PATH — worktree isolation is unavailable",
    };
  }
  const inRepo = existsSync(join(projectDir, ".git"));
  return {
    name: "git",
    status: "ok",
    detail: inRepo
      ? "available (project is a git repository)"
      : "available (project dir has no .git — worktree isolation needs one)",
  };
}

function checkBackendCommand(projectDir: string): DoctorCheck {
  let command = "claude";
  try {
    const cfg = config.loadProject(projectDir);
    command = config.get(cfg, "backend.command", "claude");
  } catch {
    /* fall through with the default */
  }
  const executable = command.split(" ")[0];
  if (commandOnPath(executable)) {
    return {
      name: "backend",
      status: "ok",
      detail: `\`${executable}\` resolves on PATH`,
    };
  }
  return {
    name: "backend",
    status: "warn",
    detail: `configured backend command \`${executable}\` not found on PATH`,
  };
}

function checkRuntimeLimits(projectDir: string): DoctorCheck {
  let iterationRaw = "";
  let runtimeRaw = "";
  try {
    const cfg = config.loadProject(projectDir);
    iterationRaw = config.get(cfg, "event_loop.max_iteration_runtime", "0");
    runtimeRaw = config.get(cfg, "event_loop.max_runtime", "0");
  } catch {
    /* fall through with the defaults */
  }
  const problems: string[] = [];
  const values: Record<string, number> = {};
  for (const [key, raw] of [
    ["max_iteration_runtime", iterationRaw],
    ["max_runtime", runtimeRaw],
  ] as const) {
    const parsed = parseDurationMs(raw);
    if (parsed === null) {
      problems.push(
        `event_loop.${key} = "${raw}" is not a valid duration — treated as disabled`,
      );
      values[key] = 0;
      continue;
    }
    if (parsed > MAX_TIMER_MS) {
      problems.push(
        `event_loop.${key} = "${raw}" exceeds the Node timer limit — clamped to ~24.8 days`,
      );
    }
    values[key] = Math.min(parsed, MAX_TIMER_MS);
  }
  if (
    values.max_iteration_runtime > 0 &&
    values.max_runtime > 0 &&
    values.max_iteration_runtime > values.max_runtime
  ) {
    problems.push(
      "event_loop.max_iteration_runtime exceeds max_runtime — iterations will be clamped to the remaining loop budget",
    );
  }
  if (problems.length > 0) {
    return {
      name: "runtime limits",
      status: "warn",
      detail: problems.join("; "),
    };
  }
  const show = (ms: number) => (ms > 0 ? `${ms}ms` : "off");
  return {
    name: "runtime limits",
    status: "ok",
    detail: `max_iteration_runtime=${show(values.max_iteration_runtime)}, max_runtime=${show(values.max_runtime)}`,
  };
}

function checkStateDir(stateDir: string): DoctorCheck {
  if (!existsSync(stateDir)) {
    return {
      name: "state",
      status: "warn",
      detail: `${stateDir} does not exist yet (created on first run)`,
    };
  }
  try {
    accessSync(stateDir, constants.W_OK);
  } catch {
    return {
      name: "state",
      status: "fail",
      detail: `${stateDir} is not writable`,
    };
  }
  return { name: "state", status: "ok", detail: `${stateDir} is writable` };
}

function checkRegistry(stateDir: string): DoctorCheck {
  const registryPath = join(stateDir, "registry.jsonl");
  if (!existsSync(registryPath)) {
    return {
      name: "registry",
      status: "ok",
      detail: "no registry yet (created on first run)",
    };
  }
  const lines = readFileSync(registryPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  let malformed = 0;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      malformed++;
    }
  }
  const runs = readRegistry(registryPath).length;
  if (malformed > 0) {
    return {
      name: "registry",
      status: "warn",
      detail: `${malformed} malformed line(s) in registry.jsonl (${runs} run(s) readable)`,
    };
  }
  return {
    name: "registry",
    status: "ok",
    detail: `${runs} run(s) recorded`,
  };
}

function checkStaleRunningRuns(stateDir: string): DoctorCheck {
  const registryPath = join(stateDir, "registry.jsonl");
  const running = readRegistry(registryPath).filter(
    (r) => r.status === "running",
  );
  const stale = running.filter((r) => r.pid !== undefined && !pidAlive(r.pid));
  if (stale.length > 0) {
    const ids = stale.map((r) => r.run_id).join(", ");
    return {
      name: "runs",
      status: "warn",
      detail: `${stale.length} run(s) marked running but the process is gone: ${ids}`,
    };
  }
  return {
    name: "runs",
    status: "ok",
    detail: `${running.length} run(s) currently running`,
  };
}

function checkWaveMarker(stateDir: string): DoctorCheck {
  const marker = join(stateDir, "waves", "active");
  if (!existsSync(marker)) {
    return { name: "waves", status: "ok", detail: "no active wave marker" };
  }
  const registryPath = join(stateDir, "registry.jsonl");
  const running = readRegistry(registryPath).filter(
    (r) => r.status === "running",
  );
  if (running.length > 0) {
    return {
      name: "waves",
      status: "ok",
      detail: "wave marker present with a running run",
    };
  }
  return {
    name: "waves",
    status: "warn",
    detail: `stale wave marker blocks future parallel waves — delete ${marker}`,
  };
}

function checkOrphanWorktrees(stateDir: string): DoctorCheck {
  let orphans = 0;
  let total = 0;
  try {
    const metas = listWorktreeMetas(stateDir);
    total = metas.length;
    orphans = metas.filter((m) => m.orphan).length;
  } catch {
    /* unreadable worktree metadata is reported as zero */
  }
  if (orphans > 0) {
    return {
      name: "worktrees",
      status: "warn",
      detail: `${orphans} orphaned worktree(s) of ${total} — run \`autoloop worktree clean\``,
    };
  }
  return {
    name: "worktrees",
    status: "ok",
    detail:
      total === 0 ? "no worktrees" : `${total} worktree(s), none orphaned`,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandOnPath(executable: string): boolean {
  if (!executable) return false;
  if (executable.includes("/")) return existsSync(executable);
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, executable), constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

function printDoctorUsage(): void {
  console.log("Usage: autoloop doctor [project-dir] [--json]");
  console.log("");
  console.log("Diagnose the environment and .autoloop state: node/git/backend");
  console.log(
    "availability, registry integrity, stale running runs, stale wave",
  );
  console.log("markers, and orphaned worktrees.");
  console.log("");
  console.log("Exit code is 1 when any check fails (warnings exit 0).");
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}
