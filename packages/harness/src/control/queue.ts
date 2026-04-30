import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  controlCapabilitiesFile,
  controlRequestsFile,
  controlStatusFile,
} from "./paths.js";
import type {
  ControlCapabilities,
  ControlPayload,
  ControlRequest,
  ControlStatus,
  ControlVerb,
} from "./types.js";

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readJsonlLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function appendRequest(
  runStateDir: string,
  request: ControlRequest,
): void {
  const path = controlRequestsFile(runStateDir);
  ensureDir(path);
  appendFileSync(path, `${JSON.stringify(request)}\n`, "utf-8");
}

export function readRequests(runStateDir: string): ControlRequest[] {
  return readJsonlLines<ControlRequest>(controlRequestsFile(runStateDir));
}

export function appendStatus(runStateDir: string, status: ControlStatus): void {
  const path = controlStatusFile(runStateDir);
  ensureDir(path);
  appendFileSync(path, `${JSON.stringify(status)}\n`, "utf-8");
}

export function readStatuses(runStateDir: string): ControlStatus[] {
  return readJsonlLines<ControlStatus>(controlStatusFile(runStateDir));
}

export function writeCapabilities(
  runStateDir: string,
  caps: ControlCapabilities,
): void {
  const path = controlCapabilitiesFile(runStateDir);
  ensureDir(path);
  writeFileSync(path, `${JSON.stringify(caps, null, 2)}\n`, "utf-8");
}

export function readCapabilities(
  runStateDir: string,
): ControlCapabilities | null {
  const path = controlCapabilitiesFile(runStateDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ControlCapabilities;
  } catch {
    return null;
  }
}

/**
 * Pending requests are requests with no status line yet — i.e. control the
 * harness has not yet acknowledged.
 */
export function pendingRequests(runStateDir: string): ControlRequest[] {
  const requests = readRequests(runStateDir);
  const acked = new Set(readStatuses(runStateDir).map((s) => s.id));
  return requests.filter((r) => !acked.has(r.id));
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function newRequestId(): string {
  return `ctl_${Date.now().toString(36)}_${randomSuffix()}`;
}

export function buildRequest(
  runId: string,
  verb: ControlVerb,
  payload: ControlPayload,
  reason = "",
): ControlRequest {
  return {
    id: newRequestId(),
    runId,
    requestedAt: new Date().toISOString(),
    verb,
    reason,
    payload,
  };
}
