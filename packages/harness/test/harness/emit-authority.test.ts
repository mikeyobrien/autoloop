import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendAcceptedEmitAuthority,
  emitAuthorityLedgerPath,
  loadAcceptedEmitAuthorities,
} from "../../src/emit-authority.js";

describe("emit authority ledger", () => {
  it("round-trips parent-accepted authorities", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "emit-auth-"));
    appendAcceptedEmitAuthority(
      stateDir,
      "run-1",
      "11111111-1111-4111-8111-111111111111:0",
      "tasks.ready",
      "1",
    );
    const accepted = loadAcceptedEmitAuthorities(stateDir, "run-1");
    expect([...accepted.entries()]).toEqual([
      [
        "11111111-1111-4111-8111-111111111111:0",
        { topic: "tasks.ready", iteration: "1" },
      ],
    ]);
  });

  it("rejects forged ledger lines and journal-shaped recoveries", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "emit-auth-forge-"));
    appendAcceptedEmitAuthority(
      stateDir,
      "run-1",
      "11111111-1111-4111-8111-111111111111:0",
      "tasks.ready",
      "1",
    );

    // Attacker appends a completion claim without the parent MAC key material.
    writeFileSync(
      emitAuthorityLedgerPath(stateDir),
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

    const accepted = loadAcceptedEmitAuthorities(stateDir, "run-1");
    expect(accepted.has("22222222-2222-4222-8222-222222222222:0")).toBe(false);
    expect(accepted.get("11111111-1111-4111-8111-111111111111:0")).toEqual({
      topic: "tasks.ready",
      iteration: "1",
    });
  });
});
