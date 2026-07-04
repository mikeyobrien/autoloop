import { describe, expect, it } from "vitest";
import {
  classifyGateOutcome,
  parseEvidenceEntry,
  validateEvidenceRequirement,
} from "../src/evidence.js";
import type { EvidenceRequirement, Gate } from "../src/topology.js";

function req(partial: Partial<EvidenceRequirement>): EvidenceRequirement {
  return { key: "key", type: "generic", ...partial };
}

describe("parseEvidenceEntry", () => {
  it("parses a token form with a trailing status word", () => {
    const entry = parseEvidenceEntry("tests=5 passed", "tests");
    expect(entry).toEqual({ raw: "5 passed", numeric: 5, status: "passed" });
  });

  it("parses a quoted token form", () => {
    const entry = parseEvidenceEntry('tests="5 ok" other=1', "tests");
    expect(entry?.raw).toBe("5 ok");
  });

  it("parses a JSON scalar form", () => {
    const entry = parseEvidenceEntry('{"coverage": 87}', "coverage");
    expect(entry).toEqual({ raw: "87", numeric: 87 });
  });

  it("parses a JSON typed {value,status} form", () => {
    const entry = parseEvidenceEntry(
      '{"tests": {"value": "5 passed", "status": "passed"}}',
      "tests",
    );
    expect(entry).toEqual({
      raw: "5 passed",
      numeric: undefined,
      status: "passed",
    });
  });

  it("strips a trailing percent sign for numeric extraction", () => {
    const entry = parseEvidenceEntry("coverage=87%", "coverage");
    expect(entry?.numeric).toBe(87);
  });

  it("returns undefined for an absent key", () => {
    expect(parseEvidenceEntry("tests=5 passed", "coverage")).toBeUndefined();
  });

  it("returns undefined for an empty payload", () => {
    expect(parseEvidenceEntry("", "tests")).toBeUndefined();
  });

  it("does not over-match an unrelated trailing word as status", () => {
    const entry = parseEvidenceEntry("tests=5 banana", "tests");
    expect(entry).toEqual({ raw: "5", numeric: 5, status: undefined });
  });
});

describe("validateEvidenceRequirement", () => {
  it("passes a coverage threshold (85 >= min 80)", () => {
    const result = validateEvidenceRequirement(
      req({ key: "coverage", type: "coverage", min: 80 }),
      "coverage=85",
    );
    expect(result).toBeNull();
  });

  it("fails a coverage threshold (70 < min 80)", () => {
    const result = validateEvidenceRequirement(
      req({ key: "coverage", type: "coverage", min: 80 }),
      "coverage=70",
    );
    expect(result).toEqual({
      key: "coverage",
      type: "coverage",
      reason: "threshold",
      detail: "value 70 is below min 80",
    });
  });

  it("fails a coverage threshold above max", () => {
    const result = validateEvidenceRequirement(
      req({ key: "coverage", type: "coverage", max: 100 }),
      "coverage=150",
    );
    expect(result?.reason).toBe("threshold");
  });

  it("passes a status check (tests=5 passed)", () => {
    const result = validateEvidenceRequirement(
      req({ key: "tests", type: "test" }),
      "tests=5 passed",
    );
    expect(result).toBeNull();
  });

  it("fails a status check (tests=5 failing)", () => {
    const result = validateEvidenceRequirement(
      req({ key: "tests", type: "test" }),
      "tests=5 failing",
    );
    expect(result).toEqual({
      key: "tests",
      type: "test",
      reason: "status",
      detail: "expected status `passed`, got `failing`",
    });
  });

  it("reports missing evidence", () => {
    const result = validateEvidenceRequirement(
      req({ key: "tests", type: "test" }),
      "coverage=90",
    );
    expect(result?.reason).toBe("missing");
  });

  it("a generic-typed requirement is presence-only (no threshold/status check)", () => {
    const result = validateEvidenceRequirement(
      req({ key: "commit", type: "generic" }),
      "commit=abc123",
    );
    expect(result).toBeNull();
  });
});

describe("classifyGateOutcome", () => {
  const gate: Pick<Gate, "blocked" | "failed"> = {
    blocked: "x.blocked",
    failed: "x.failed",
  };

  it("routes missing evidence to blocked even when failed is configured", () => {
    const outcome = classifyGateOutcome(
      [{ key: "tests", type: "test", reason: "missing", detail: "" }],
      gate,
    );
    expect(outcome).toBe("x.blocked");
  });

  it("routes a threshold shortfall to failed when configured", () => {
    const outcome = classifyGateOutcome(
      [{ key: "coverage", type: "coverage", reason: "threshold", detail: "" }],
      gate,
    );
    expect(outcome).toBe("x.failed");
  });

  it("falls back to blocked when failed is not configured", () => {
    const outcome = classifyGateOutcome(
      [{ key: "coverage", type: "coverage", reason: "threshold", detail: "" }],
      { blocked: "x.blocked" },
    );
    expect(outcome).toBe("x.blocked");
  });

  it("prefers blocked when both missing and threshold shortfalls are present", () => {
    const outcome = classifyGateOutcome(
      [
        { key: "tests", type: "test", reason: "missing", detail: "" },
        { key: "coverage", type: "coverage", reason: "threshold", detail: "" },
      ],
      gate,
    );
    expect(outcome).toBe("x.blocked");
  });
});
