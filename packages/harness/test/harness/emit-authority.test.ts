import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendAcceptedEmitAuthority,
  emitAuthorityKeyPath,
  emitAuthorityLedgerPath,
  loadAcceptedEmitAuthorities,
  resolveEmitAuthorityPaths,
} from "../../src/emit-authority.js";

describe("emit authority private ledger", () => {
  it("stores materials outside AUTOLOOP_STATE_DIR", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "emit-auth-proj-"));
    const stateDir = join(projectDir, ".autoloop", "runs", "run-1");
    mkdirSync(stateDir, { recursive: true });
    const paths = resolveEmitAuthorityPaths("run-1", projectDir, stateDir);
    expect(paths.dir.includes(stateDir)).toBe(false);
    expect(paths.keyPath.startsWith(stateDir)).toBe(false);
  });

  it("round-trips parent-accepted authorities", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "emit-auth-rt-"));
    const stateDir = join(projectDir, ".autoloop", "runs", "run-1");
    const paths = resolveEmitAuthorityPaths("run-1", projectDir, stateDir);
    appendAcceptedEmitAuthority(
      paths,
      "run-1",
      "11111111-1111-4111-8111-111111111111:0",
      "tasks.ready",
      "1",
    );
    const accepted = loadAcceptedEmitAuthorities(paths, "run-1");
    expect([...accepted.entries()]).toEqual([
      [
        "11111111-1111-4111-8111-111111111111:0",
        { topic: "tasks.ready", iteration: "1" },
      ],
    ]);
    expect(existsSync(join(stateDir, ".emit-authority.key"))).toBe(false);
    expect(existsSync(join(stateDir, "emit-authority.jsonl"))).toBe(false);
  });

  it("rejects forged ledger lines and pre-seeded wrong-size keys", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "emit-auth-forge-"));
    const stateDir = join(projectDir, ".autoloop", "runs", "run-1");
    const paths = resolveEmitAuthorityPaths("run-1", projectDir, stateDir);

    appendAcceptedEmitAuthority(
      paths,
      "run-1",
      "11111111-1111-4111-8111-111111111111:0",
      "tasks.ready",
      "1",
    );

    writeFileSync(
      emitAuthorityLedgerPath(paths),
      `${JSON.stringify({
        v: 1,
        run: "run-1",
        authority_id: "22222222-2222-4222-8222-222222222222:0",
        topic: "task.complete",
        iteration: "2",
        mac: "deadbeef",
      })}\n`,
      { flag: "a" },
    );

    const accepted = loadAcceptedEmitAuthorities(paths, "run-1");
    expect(accepted.has("22222222-2222-4222-8222-222222222222:0")).toBe(false);
    expect(accepted.get("11111111-1111-4111-8111-111111111111:0")).toEqual({
      topic: "tasks.ready",
      iteration: "1",
    });

    // Pre-seed under stateDir must not be consulted.
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, ".emit-authority.key"), Buffer.alloc(32, 7));
    writeFileSync(
      join(stateDir, "emit-authority.jsonl"),
      `${JSON.stringify({
        v: 1,
        run: "run-1",
        authority_id: "33333333-3333-4333-8333-333333333333:0",
        topic: "task.complete",
        iteration: "1",
        mac: "00",
      })}\n`,
    );
    const still = loadAcceptedEmitAuthorities(paths, "run-1");
    expect(still.has("33333333-3333-4333-8333-333333333333:0")).toBe(false);

    // Wrong-size pre-seeded private key is refused on write.
    const paths2 = resolveEmitAuthorityPaths("run-2", projectDir, stateDir);
    mkdirSync(paths2.dir, { recursive: true });
    writeFileSync(emitAuthorityKeyPath(paths2), Buffer.from("short"));
    expect(() =>
      appendAcceptedEmitAuthority(
        paths2,
        "run-2",
        "11111111-1111-4111-8111-111111111111:0",
        "tasks.ready",
        "1",
      ),
    ).toThrow(/unexpected length/);
  });
});
