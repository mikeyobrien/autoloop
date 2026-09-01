import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export interface AcceptedEmitAuthority {
  topic: string;
  iteration: string;
}

export interface EmitAuthorityPaths {
  /** Parent-only directory. Must not be under AUTOLOOP_STATE_DIR. */
  dir: string;
  keyPath: string;
  ledgerPath: string;
}

export interface ParentAuthoritySink {
  runtime: { runId: string };
  paths: {
    projectDir: string;
    stateDir: string;
  };
  emitAuthority?: {
    accepted: Map<string, AcceptedEmitAuthority>;
  };
}

/**
 * Issue a parent-owned acceptance id, record it in memory + durable ledger, and
 * return the id for stamping on the journal line. Used for harness routing
 * events (parallel joins) and parent-generated event.invalid telemetry.
 */
export function acceptParentJournalRecord(
  loop: ParentAuthoritySink,
  iteration: string,
  topic: string,
): string {
  if (!loop.emitAuthority) {
    loop.emitAuthority = { accepted: new Map() };
  }
  const authorityId = `${randomUUID()}:p${loop.emitAuthority.accepted.size}`;
  loop.emitAuthority.accepted.set(authorityId, { topic, iteration });
  appendAcceptedEmitAuthority(
    resolveEmitAuthorityPaths(
      loop.runtime.runId,
      loop.paths.projectDir,
      loop.paths.stateDir,
    ),
    loop.runtime.runId,
    authorityId,
    topic,
    iteration,
  );
  return authorityId;
}

interface LedgerRecord {
  v: 1;
  run: string;
  authority_id: string;
  topic: string;
  iteration: string;
  mac: string;
}

/**
 * Resolve a durable parent-only authority home outside the backend-exported
 * run state directory. Prefer XDG_RUNTIME_DIR (not under PROJECT_DIR). Fall
 * back to a hashed path under the process temp root.
 *
 * Backends receive AUTOLOOP_STATE_DIR / PROJECT_DIR / JOURNAL paths; this
 * directory is intentionally never exported.
 */
export function resolveEmitAuthorityPaths(
  runId: string,
  projectDir: string,
  stateDir: string,
): EmitAuthorityPaths {
  const runtimeRoot =
    process.env.XDG_RUNTIME_DIR?.trim() ||
    join(tmpdir(), `autoloop-${process.getuid?.() ?? "user"}`);

  // Bind the location to project+run without placing files under stateDir.
  // A backend that only writes exported state/journal paths cannot reach this
  // tree without scanning the runtime/temp root.
  const token = createHash("sha256")
    .update(`autoloop-emit-authority-v1\0${resolve(projectDir)}\0${runId}`)
    .digest("hex")
    .slice(0, 40);

  const dir = join(runtimeRoot, "autoloop-emit-authority", token);
  // Refuse to place authority materials under the exported state directory.
  if (
    resolve(dir) === resolve(stateDir) ||
    resolve(dir).startsWith(`${resolve(stateDir)}${sep}`)
  ) {
    throw new Error(
      "emit authority path collides with AUTOLOOP_STATE_DIR; refusing",
    );
  }
  return {
    dir,
    keyPath: join(dir, "key"),
    ledgerPath: join(dir, "ledger.jsonl"),
  };
}

function loadOrCreateKey(keyPath: string, ledgerPath: string): Buffer {
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const ledgerExists = existsSync(ledgerPath);

  // New run (no ledger yet): always mint a fresh parent key so a pre-seeded
  // attacker file under the private path cannot become issuance material.
  if (!ledgerExists) {
    const key = randomBytes(32);
    writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  // Resume path: ledger already exists; load the existing 32-byte key only.
  try {
    const fd = openSync(
      keyPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    // Ledger without key is corrupt; mint a new key but it will not validate
    // prior ledger lines (fail closed for those records).
    try {
      const key = randomBytes(32);
      writeSync(fd, key);
      return key;
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code !== "EEXIST") throw err;
  }

  const existing = readFileSync(keyPath);
  if (existing.length !== 32) {
    throw new Error(
      "emit authority key has unexpected length; refusing untrusted key material",
    );
  }
  return existing;
}

function macRecord(
  key: Buffer,
  record: Omit<LedgerRecord, "mac" | "v">,
): string {
  return createHmac("sha256", key)
    .update(
      `${record.run}\0${record.authority_id}\0${record.topic}\0${record.iteration}`,
    )
    .digest("hex");
}

/** Parent-only durable acceptance record. Never export these paths to backends. */
export function appendAcceptedEmitAuthority(
  paths: EmitAuthorityPaths,
  runId: string,
  authorityId: string,
  topic: string,
  iteration: string,
): void {
  const key = loadOrCreateKey(paths.keyPath, paths.ledgerPath);
  const body = {
    run: runId,
    authority_id: authorityId,
    topic,
    iteration,
  };
  const record: LedgerRecord = {
    v: 1,
    ...body,
    mac: macRecord(key, body),
  };
  mkdirSync(dirname(paths.ledgerPath), { recursive: true, mode: 0o700 });
  appendFileSync(paths.ledgerPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Recover parent-accepted emit identities from the harness-owned ledger.
 * Journal agent lines are intentionally ignored: the backend can write the
 * journal, so it is not issuance evidence.
 */
export function loadAcceptedEmitAuthorities(
  paths: EmitAuthorityPaths,
  runId: string,
): Map<string, AcceptedEmitAuthority> {
  const accepted = new Map<string, AcceptedEmitAuthority>();
  if (!existsSync(paths.keyPath) || !existsSync(paths.ledgerPath)) {
    return accepted;
  }

  let key: Buffer;
  try {
    key = readFileSync(paths.keyPath);
  } catch {
    return accepted;
  }
  if (key.length !== 32) return accepted;

  let text = "";
  try {
    text = readFileSync(paths.ledgerPath, "utf8");
  } catch {
    return accepted;
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<LedgerRecord>;
      if (
        parsed.v !== 1 ||
        parsed.run !== runId ||
        typeof parsed.authority_id !== "string" ||
        typeof parsed.topic !== "string" ||
        typeof parsed.iteration !== "string" ||
        typeof parsed.mac !== "string"
      ) {
        continue;
      }
      const expected = macRecord(key, {
        run: parsed.run,
        authority_id: parsed.authority_id,
        topic: parsed.topic,
        iteration: parsed.iteration,
      });
      if (expected !== parsed.mac) continue;
      if (accepted.has(parsed.authority_id)) continue;
      accepted.set(parsed.authority_id, {
        topic: parsed.topic,
        iteration: parsed.iteration,
      });
    } catch {
      // Ignore untrusted/malformed ledger lines.
    }
  }
  return accepted;
}

// Keep path helpers for tests without exposing stateDir-relative names.
export function emitAuthorityKeyPath(paths: EmitAuthorityPaths): string {
  return paths.keyPath;
}

export function emitAuthorityLedgerPath(paths: EmitAuthorityPaths): string {
  return paths.ledgerPath;
}
