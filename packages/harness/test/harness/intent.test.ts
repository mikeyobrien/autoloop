import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTopic } from "@mobrienv/autoloop-core/journal";
import {
  captureAcceptanceContract,
  journalAcceptanceContract,
  parseCriterion,
  parseObjectiveCriteria,
  runIntentCriteria,
} from "@mobrienv/autoloop-harness/intent";
import type { LoopContext } from "@mobrienv/autoloop-harness/types";
import { describe, expect, it } from "vitest";

function makeLoop(criteria: string[], objective = ""): LoopContext {
  const workDir = mkdtempSync(join(tmpdir(), "autoloop-intent-"));
  const stateDir = join(workDir, ".autoloop");
  mkdirSync(stateDir, { recursive: true });
  const journalFile = join(stateDir, "journal.jsonl");
  writeFileSync(journalFile, "", "utf-8");
  return {
    objective,
    acceptance: { criteria, timeoutMs: 30000 },
    paths: { workDir, journalFile },
    runtime: { runId: "run-intent" },
  } as unknown as LoopContext;
}

describe("parseCriterion", () => {
  it("splits a bound check from the criterion text", () => {
    expect(
      parseCriterion("API returns 200 :: curl -sf localhost/health"),
    ).toEqual({ text: "API returns 200", check: "curl -sf localhost/health" });
  });
  it("returns text-only when there is no check", () => {
    expect(parseCriterion("looks nice")).toEqual({ text: "looks nice" });
  });
});

describe("parseObjectiveCriteria", () => {
  it("extracts the bullets under an Acceptance criteria heading", () => {
    const obj = [
      "Build a login page.",
      "",
      "## Acceptance criteria",
      "- user can log in",
      "- session persists :: test -f session.txt",
      "",
      "## Notes",
      "- ignore this",
    ].join("\n");
    expect(parseObjectiveCriteria(obj)).toEqual([
      "user can log in",
      "session persists :: test -f session.txt",
    ]);
  });
  it("returns [] when no section is present", () => {
    expect(parseObjectiveCriteria("just do the thing")).toEqual([]);
  });
});

describe("captureAcceptanceContract", () => {
  it("merges config and objective criteria, deduped by text", () => {
    const loop = makeLoop(
      ["config criterion :: true"],
      "## Acceptance criteria\n- config criterion\n- objective only",
    );
    const c = captureAcceptanceContract(loop);
    expect(c.map((x) => x.text)).toEqual([
      "config criterion",
      "objective only",
    ]);
    // The config form (with a check) wins for the deduped entry.
    expect(c[0].check).toBe("true");
  });
});

describe("journalAcceptanceContract", () => {
  it("journals the bound contract when criteria exist", () => {
    const loop = makeLoop(["c1 :: true", "c2"]);
    journalAcceptanceContract(loop);
    const topics = readFileSync(loop.paths.journalFile, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => extractTopic(l));
    expect(topics).toContain("acceptance.contract");
  });
  it("is a no-op when there are no criteria", () => {
    const loop = makeLoop([]);
    journalAcceptanceContract(loop);
    expect(readFileSync(loop.paths.journalFile, "utf-8")).toBe("");
  });
});

describe("runIntentCriteria", () => {
  it("is a no-op when no criterion binds a check", () => {
    const loop = makeLoop(["advisory only", "another"]);
    expect(runIntentCriteria(loop, 1)).toEqual({
      ran: false,
      passed: true,
      failures: [],
    });
  });

  it("passes when every bound check passes", () => {
    const loop = makeLoop(["ok :: true", "also ok :: exit 0"]);
    expect(runIntentCriteria(loop, 1).passed).toBe(true);
  });

  it("fails acceptance when a bound criterion check fails (wrong feature)", () => {
    const loop = makeLoop([
      "endpoint exists :: false",
      "passes its own tests :: true",
    ]);
    const result = runIntentCriteria(loop, 1);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].text).toBe("endpoint exists");
  });

  it("binds criteria parsed from the objective", () => {
    const loop = makeLoop(
      [],
      "## Acceptance criteria\n- feature present :: false",
    );
    expect(runIntentCriteria(loop, 1).passed).toBe(false);
  });
});
