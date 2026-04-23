import { existsSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanRunScopedDirs,
  createRunScopedDir,
  runScopedPath,
} from "../../src/isolation/run-scope.js";

function makeTempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "autoloop-ts-runscope-"));
}

describe("runScopedPath", () => {
  it("returns path under runs/<runId>", () => {
    const result = runScopedPath("/tmp/.autoloop", "run-abc");
    expect(result).toBe("/tmp/.autoloop/runs/run-abc");
  });
});

describe("createRunScopedDir", () => {
  it("creates the run-scoped directory", () => {
    const base = makeTempStateDir();
    const dir = createRunScopedDir(base, "run-xyz");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(base, "runs", "run-xyz"));
  });

  it("is idempotent", () => {
    const base = makeTempStateDir();
    const dir1 = createRunScopedDir(base, "run-xyz");
    const dir2 = createRunScopedDir(base, "run-xyz");
    expect(dir1).toBe(dir2);
    expect(existsSync(dir1)).toBe(true);
  });
});

describe("cleanRunScopedDirs", () => {
  it("removes directories for non-active runs", () => {
    const base = makeTempStateDir();
    createRunScopedDir(base, "run-active");
    createRunScopedDir(base, "run-done");
    createRunScopedDir(base, "run-old");

    const activeRunIds = new Set(["run-active"]);
    const removed = cleanRunScopedDirs(base, { activeRunIds });

    expect(removed.sort()).toEqual(["run-done", "run-old"]);
    expect(existsSync(join(base, "runs", "run-active"))).toBe(true);
    expect(existsSync(join(base, "runs", "run-done"))).toBe(false);
    expect(existsSync(join(base, "runs", "run-old"))).toBe(false);
  });

  it("returns empty array when no runs dir exists", () => {
    const base = makeTempStateDir();
    const removed = cleanRunScopedDirs(base, { activeRunIds: new Set() });
    expect(removed).toEqual([]);
  });

  it("returns empty array when all runs are active", () => {
    const base = makeTempStateDir();
    createRunScopedDir(base, "run-a");
    createRunScopedDir(base, "run-b");

    const removed = cleanRunScopedDirs(base, {
      activeRunIds: new Set(["run-a", "run-b"]),
    });
    expect(removed).toEqual([]);
  });

  it("respects maxAgeDays — keeps recent directories", () => {
    const base = makeTempStateDir();
    createRunScopedDir(base, "run-recent");
    createRunScopedDir(base, "run-stale");

    // Make run-stale look 10 days old
    const stalePath = join(base, "runs", "run-stale");
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(stalePath, tenDaysAgo, tenDaysAgo);

    const removed = cleanRunScopedDirs(base, {
      activeRunIds: new Set(),
      maxAgeDays: 7,
    });

    expect(removed).toEqual(["run-stale"]);
    expect(existsSync(join(base, "runs", "run-recent"))).toBe(true);
    expect(existsSync(stalePath)).toBe(false);
  });

  it("maxAgeDays 0 removes all non-active regardless of age", () => {
    const base = makeTempStateDir();
    createRunScopedDir(base, "run-a");
    createRunScopedDir(base, "run-b");

    const removed = cleanRunScopedDirs(base, {
      activeRunIds: new Set(),
      maxAgeDays: 0,
    });
    expect(removed.sort()).toEqual(["run-a", "run-b"]);
  });
});
