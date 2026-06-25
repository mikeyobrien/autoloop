import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface SyncEntry {
  taskId: string;
  tracker: string;
  externalId: string;
  lastSyncedStatus: string;
  branchName?: string;
  /** Human-facing identifier (e.g. "SAU-22") carried for display on push/release. */
  identifier?: string;
  /** Issue title, carried so push/release can comment/report without the task. */
  title?: string;
}

export interface SyncState {
  entries: SyncEntry[];
}

export function loadState(stateFile: string): SyncState {
  if (!existsSync(stateFile)) return { entries: [] };
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "entries" in parsed &&
      Array.isArray((parsed as { entries: unknown }).entries)
    ) {
      return parsed as SyncState;
    }
  } catch {
    /* corrupt or empty state — start fresh */
  }
  return { entries: [] };
}

export function saveState(stateFile: string, state: SyncState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  // Write atomically so a crash or concurrent reader never sees a torn file.
  const tmp = `${stateFile}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  renameSync(tmp, stateFile);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serialize a load-modify-save section across concurrent runs (autoloop allows
 * parallel runs on one checkout). Exclusive lockfile, bounded wait, stale-steal.
 */
export async function withStateLock<T>(
  stateFile: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const lockPath = `${stateFile}.lock`;
  const TIMEOUT_MS = 10_000;
  const STALE_MS = 60_000;
  const start = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      break;
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* lock vanished between calls — retry immediately */
      }
      if (Date.now() - start > TIMEOUT_MS) {
        throw new Error(`issue-sync: timed out acquiring ${lockPath}`);
      }
      sleepSync(50);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      /* already released */
    }
  }
}

export function findByExternalId(
  state: SyncState,
  tracker: string,
  externalId: string,
): SyncEntry | undefined {
  return state.entries.find(
    (e) => e.tracker === tracker && e.externalId === externalId,
  );
}

export function findByTaskId(
  state: SyncState,
  taskId: string,
): SyncEntry | undefined {
  return state.entries.find((e) => e.taskId === taskId);
}

export function upsertEntry(state: SyncState, entry: SyncEntry): SyncState {
  // Keyed by the durable issue identity (tracker + externalId), not the ephemeral
  // taskId — so re-pulling an issue across runs updates one entry instead of leaking.
  const idx = state.entries.findIndex(
    (e) => e.tracker === entry.tracker && e.externalId === entry.externalId,
  );
  const entries =
    idx >= 0
      ? [...state.entries.slice(0, idx), entry, ...state.entries.slice(idx + 1)]
      : [...state.entries, entry];
  return { ...state, entries };
}
