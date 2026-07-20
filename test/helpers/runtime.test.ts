import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CliResult,
  cleanupTempProjects,
  expectCliStatus,
  makeTempProject,
} from "./runtime.js";

function result(overrides: Partial<CliResult> = {}): CliResult {
  return {
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe("expectCliStatus", () => {
  it("accepts the expected exit status", () => {
    expect(() => expectCliStatus(result(), 0)).not.toThrow();
  });

  it("reports signal, spawn error, and process output on failure", () => {
    expect(() =>
      expectCliStatus(
        result({
          status: null,
          signal: "SIGTERM",
          spawnError: "spawnSync node ETIMEDOUT",
          stdout: "partial output",
          stderr: "timed out",
        }),
        0,
      ),
    ).toThrowError(
      /received null[\s\S]*SIGTERM[\s\S]*ETIMEDOUT[\s\S]*partial output[\s\S]*timed out/,
    );
  });
});

describe("temporary integration projects", () => {
  it("removes every project registered by the worker", () => {
    const first = makeTempProject("cleanup-first");
    const second = makeTempProject("cleanup-second");

    cleanupTempProjects();

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });
});
