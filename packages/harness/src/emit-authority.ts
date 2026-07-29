import { createHmac, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface AcceptedEmitAuthority {
  topic: string;
  iteration: string;
}

interface LedgerRecord {
  v: 1;
  run: string;
  authority_id: string;
  topic: string;
  iteration: string;
  mac: string;
}

const KEY_NAME = ".emit-authority.key";
const LEDGER_NAME = "emit-authority.jsonl";

export function emitAuthorityKeyPath(stateDir: string): string {
  return join(stateDir, KEY_NAME);
}

export function emitAuthorityLedgerPath(stateDir: string): string {
  return join(stateDir, LEDGER_NAME);
}

function loadOrCreateKey(stateDir: string): Buffer {
  const keyPath = emitAuthorityKeyPath(stateDir);
  mkdirSync(dirname(keyPath), { recursive: true });
  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
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

/** Parent-only durable acceptance record. Never export this path to backends. */
export function appendAcceptedEmitAuthority(
  stateDir: string,
  runId: string,
  authorityId: string,
  topic: string,
  iteration: string,
): void {
  const key = loadOrCreateKey(stateDir);
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
  const ledgerPath = emitAuthorityLedgerPath(stateDir);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, {
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
  stateDir: string,
  runId: string,
): Map<string, AcceptedEmitAuthority> {
  const accepted = new Map<string, AcceptedEmitAuthority>();
  const keyPath = emitAuthorityKeyPath(stateDir);
  const ledgerPath = emitAuthorityLedgerPath(stateDir);
  if (!existsSync(keyPath) || !existsSync(ledgerPath)) return accepted;

  let key: Buffer;
  try {
    key = readFileSync(keyPath);
  } catch {
    return accepted;
  }

  let text = "";
  try {
    text = readFileSync(ledgerPath, "utf8");
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
