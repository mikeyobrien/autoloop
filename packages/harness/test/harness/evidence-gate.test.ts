import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import {
  deriveBlockedTopic,
  gateForEvent,
  loadTopology,
} from "@mobrienv/autoloop-core/topology";
import {
  emit,
  missingEvidence,
  payloadEvidenceKeys,
} from "@mobrienv/autoloop-harness/emit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function tmpProject(topologyToml: string): string {
  const dir = join(
    tmpdir(),
    `autoloop-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".autoloop"), { recursive: true });
  writeFileSync(join(dir, "autoloops.toml"), "");
  writeFileSync(join(dir, "topology.toml"), topologyToml);
  return dir;
}

describe("payloadEvidenceKeys / missingEvidence", () => {
  it("detects key=value and key: value tokens with non-empty values", () => {
    const keys = payloadEvidenceKeys("tests=42 passed, coverage: 87%");
    expect(keys.has("tests")).toBe(true);
    expect(keys.has("coverage")).toBe(true);
  });

  it("ignores keys with empty values", () => {
    const keys = payloadEvidenceKeys("tests= coverage=87");
    expect(keys.has("tests")).toBe(false);
    expect(keys.has("coverage")).toBe(true);
  });

  it("reads JSON object payloads", () => {
    const keys = payloadEvidenceKeys(
      '{"tests": "pass", "coverage": 0.87, "empty": ""}',
    );
    expect(keys.has("tests")).toBe(true);
    expect(keys.has("coverage")).toBe(true);
    expect(keys.has("empty")).toBe(false);
  });

  it("returns required keys absent from the payload, in declaration order", () => {
    expect(
      missingEvidence(["tests", "coverage", "lint"], "tests=ok lint=clean"),
    ).toEqual(["coverage"]);
    expect(missingEvidence(["tests"], "tests=ok")).toEqual([]);
    expect(missingEvidence(["tests"], "")).toEqual(["tests"]);
  });
});

describe("deriveBlockedTopic", () => {
  it("replaces the last dotted segment with blocked", () => {
    expect(deriveBlockedTopic("verify.passed")).toBe("verify.blocked");
    expect(deriveBlockedTopic("build.done")).toBe("build.blocked");
  });
  it("appends .blocked for a single-segment event", () => {
    expect(deriveBlockedTopic("done")).toBe("done.blocked");
  });
});

describe("evidence gate (emit)", () => {
  let dir: string;
  let journalFile: string;

  const TOPO = [
    'name = "t"',
    "",
    "[[gate]]",
    'event = "verify.passed"',
    'requires = ["tests", "coverage"]',
    "",
  ].join("\n");

  beforeEach(() => {
    dir = tmpProject(TOPO);
    journalFile = join(dir, ".autoloop/journal.jsonl");
    appendEvent(journalFile, "run-1", "1", "loop.start", "");

    vi.stubEnv("AUTOLOOP_PROJECT_DIR", dir);
    vi.stubEnv("AUTOLOOP_JOURNAL_FILE", journalFile);
    vi.stubEnv("AUTOLOOP_RUN_ID", "run-1");
    vi.stubEnv("AUTOLOOP_ITERATION", "1");
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "verify.passed");
    vi.stubEnv("AUTOLOOP_RECENT_EVENT", "loop.start");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it("loads the gate from topology.toml with a derived blocked topic", () => {
    const gate = gateForEvent(loadTopology(dir), "verify.passed");
    expect(gate).toBeDefined();
    expect(gate?.requires).toEqual(["tests", "coverage"]);
    expect(gate?.blocked).toBe("verify.blocked");
  });

  it("blocks the success event when evidence is missing, emitting the typed blocked event", () => {
    const result = emit(dir, "verify.passed", "looks good to me");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("requires evidence");
    expect(result.error).toContain("coverage");
    expect(result.error).toContain("verify.blocked");

    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain('"topic": "verify.blocked"');
    expect(journal).toContain("missing_evidence");
    // The unsupported success event was NOT accepted.
    expect(journal).not.toContain('"topic": "verify.passed"');
  });

  it("accepts the success event when all required evidence is present", () => {
    const result = emit(dir, "verify.passed", "tests=42 passed coverage=87%");

    expect(result.ok).toBe(true);
    const journal = readFileSync(journalFile, "utf-8");
    expect(journal).toContain('"topic": "verify.passed"');
    expect(journal).not.toContain('"topic": "verify.blocked"');
  });

  it("blocks when only some evidence is present, listing only the missing keys", () => {
    const result = emit(dir, "verify.passed", "tests=42 passed");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("coverage");
    expect(result.error).not.toMatch(/missing:[^.]*\btests\b/);
  });

  it("does not gate events without a configured gate (default = no behavior change)", () => {
    vi.stubEnv("AUTOLOOP_ALLOWED_EVENTS", "tasks.ready");
    const result = emit(dir, "tasks.ready", "no evidence needed");
    expect(result.ok).toBe(true);
  });
});
