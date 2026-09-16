// Detached engine-spawned sleeper for timed waits (T-030).
//
// Invoked as:
//   node auto-resume-child.js '<JSON spec array>'
// where spec = [registryFile, journalFile, runId, waitId, durationMs,
// projectRoot, selfCommand, stateDir]. The engine spawns this process with
// `detached: true` and stdio ignored, then exits 0 — the park stays
// process-free while this sleeper owns the only live handle.
//
// At fire time it re-checks that the run is still parked on THIS wait
// (registry status `waiting` AND the latest unmatched wait.open still
// carries the armed wait_id), then invokes the existing resume path via the
// same selfCommand the run was launched with. If a manual Wake/steer resume
// already moved the run (running/completed/failed, or a newer wait.open),
// the timer skips: the resume path closes exactly the latest unmatched open,
// so one wait.close per wait.open is preserved by construction.

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openWaitFromLines } from "@mobrienv/autoloop-harness/wait";

interface SleepSpec {
  registryFile: string;
  journalFile: string;
  runId: string;
  waitId: string;
  durationMs: number;
  projectRoot: string;
  selfCommand: string;
  stateDir: string;
}

function parseSpec(raw: string): SleepSpec | null {
  try {
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr) || arr.length < 8) return null;
    const durationMs = Number(arr[4]);
    if (!Number.isFinite(durationMs) || durationMs < 0) return null;
    return {
      registryFile: arr[0],
      journalFile: arr[1],
      runId: arr[2],
      waitId: arr[3],
      durationMs,
      projectRoot: arr[5],
      selfCommand: arr[6],
      stateDir: arr[7],
    };
  } catch {
    return null;
  }
}

function loadSpec(): SleepSpec {
  const raw = process.argv[2];
  const parsed = raw ? parseSpec(raw) : null;
  if (!parsed) {
    process.stderr.write(
      "auto-resume-child: missing or invalid spec argument\n",
    );
    process.exit(2);
  }
  return parsed;
}

const spec = loadSpec();

const logPath = join(spec.stateDir, "auto-resume.log");
const logFd = openSync(logPath, "a");

function say(line: string): void {
  try {
    appendFileSync(
      logFd,
      `[auto-resume ${new Date().toISOString()}] ${line}\n`,
    );
  } catch {
    /* best-effort, never block the resume path */
  }
}

/** Latest registry status for runId, or null when unreadable/unknown. */
function latestStatus(): string | null {
  let status: string | null = null;
  try {
    const lines = readFileSync(spec.registryFile, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { run_id?: string; status?: string };
        if (rec.run_id === spec.runId && typeof rec.status === "string") {
          status = rec.status;
        }
      } catch {
        /* skip corrupt/partial lines */
      }
    }
  } catch {
    return null;
  }
  return status;
}

/** Latest unmatched wait.open for runId, or null. */
function latestOpenWait(): { waitId: string } | null {
  try {
    const lines = readFileSync(spec.journalFile, "utf-8").split("\n");
    return openWaitFromLines(lines, spec.runId);
  } catch {
    return null;
  }
}

setTimeout(() => {
  const status = latestStatus();
  const open = latestOpenWait();
  if (status !== "waiting" || !open || open.waitId !== spec.waitId) {
    say(
      `skip run_id=${spec.runId} status=${status ?? "unreadable"} ` +
        `open_wait=${open ? open.waitId : "none"} armed=${spec.waitId}`,
    );
    closeSync(logFd);
    process.exit(0);
  }
  say(
    `firing resume run_id=${spec.runId} wait_id=${spec.waitId} ` +
      `duration_ms=${spec.durationMs}`,
  );
  const resumeCmd = `${spec.selfCommand || "autoloop"} resume ${spec.runId}`;
  const child = spawn("/bin/sh", ["-c", resumeCmd], {
    cwd: spec.projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, AUTOLOOP_PROJECT_DIR: spec.projectRoot },
  });
  child.unref();
  closeSync(logFd);
  process.exit(0);
}, spec.durationMs);
