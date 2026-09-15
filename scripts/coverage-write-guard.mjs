// Coverage temp-write guard (T-032): harden vitest's coverage temp I/O against
// a mid-run `coverage/.tmp` disappearance. Two failure classes observed:
//
//   1. WRITE side: BaseCoverageProvider.onAfterSuiteRun writes
//      `<reportsDirectory>/.tmp/coverage-<n>.json` with a bare `writeFile`
//      (no `mkdir`); if the temp dir is missing at write time the write
//      rejects unhandled and Node kills the process with rc=1 while every
//      test passed (vitest #10111; upstream fix #10117 = ensure dir first).
//   2. READ side: files written before a mid-run deletion vanish before
//      `readCoverageFiles` reads them back (vitest #9758). The writer and the
//      reader are the SAME main process, so the payload can be kept in memory
//      as a cache; disk remains the source of truth, memory is only a
//      re-read fallback (bounded by actual writes — no OOM build-up).
//
// Both are patched onto `fs.promises` here so the guard applies inside the
// vitest process that owns the provider (loaded via `--import` by
// scripts/coverage-gate.mjs). No-op on normal runs.
import fs from "node:fs";

const { writeFile, readFile, mkdir } = fs.promises;

// Matches `.../coverage/.tmp/...` and sharded `.tmp-<index>-<count>` variants.
const COVERAGE_TMP_PATH = /[/\\]coverage[/\\]\.tmp(?:-[^/\\]+)?[/\\]/;

/** In-memory fallback for coverage-*.json payloads written by this process. */
const coverageCache = new Map();

fs.promises.writeFile = function (file, data, options) {
  if (typeof file === "string" && COVERAGE_TMP_PATH.test(file)) {
    const dir = file.slice(0, file.lastIndexOf("/"));
    return mkdir(dir, { recursive: true })
      .then(() => writeFile(file, data, options))
      .then(() => {
        if (options === "utf-8" || options === "utf8") {
          coverageCache.set(file, Buffer.from(String(data), "utf-8"));
        } else {
          coverageCache.set(file, Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        }
        return undefined;
      });
  }
  return writeFile(file, data, options);
};

fs.promises.readFile = function (file, ...rest) {
  if (typeof file === "string" && COVERAGE_TMP_PATH.test(file)) {
    const cached = coverageCache.get(file);
    if (cached !== undefined) {
      const encoding = rest[0];
      if (encoding === "utf-8" || encoding === "utf8") return Promise.resolve(cached.toString("utf-8"));
      return Promise.resolve(encoding ? cached.toString(encoding) : cached);
    }
  }
  return readFile(file, ...rest);
};
