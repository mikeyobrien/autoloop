// Hardened coverage gate for `npm run test:coverage` (T-032).
//
// The merge gate (`npm run check`) must be deterministic without masking real
// failures. This wrapper runs the vitest coverage leg and retries ONLY
// infra-class deaths:
//
//   - exit code 0                          -> pass through
//   - vitest reports test failures         -> pass through rc=1 (real red)
//   - coverage threshold errors            -> pass through rc=1 (real red)
//   - no result summary at all             -> infra death (worker bootstrap
//     module-resolution crash, killed process): retry once, then honest rc
//   - summary with zero test failures but  -> infra-class (coverage temp dir
//     an Unhandled Rejection/Error line       vanished, late unhandled
//     rejection): retry once, then honest rc
//
// A genuinely failing test always reports "N failed" in the summary and is
// never retried into silence; a genuinely missing dependency (e.g. broken
// node_modules) fails identically on the retry and still yields rc=1.
//
// Flake tolerance (ticket item C): `--retry 1` retries a failed test once
// inside vitest; a test that keeps failing still exits rc=1.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestEntry = resolve(root, "node_modules/vitest/vitest.mjs");
const guard = resolve(root, "scripts/coverage-write-guard.mjs");

const INFRA_TEXT = /Unhandled|ENOENT|Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND/;

function hasResultSummary(text) {
  return /Test Files\s+\d+/.test(text);
}

function hasTestFailures(text) {
  return /\b\d+\s+failed\b/.test(text);
}

function isInfraDeath(code, output) {
  if (code === 0) return false;
  if (!hasResultSummary(output)) return true; // vitest died before reporting
  if (hasTestFailures(output)) return false; // real red — never retry
  return INFRA_TEXT.test(output); // green suite + unhandled infra line
}

function runVitest() {
  return new Promise((resolvePromise) => {
    const args = [
      "--experimental-vm-modules",
      "--import",
      guard,
      vitestEntry,
      "run",
      "--no-file-parallelism",
      "--coverage",
      "--retry",
      "1",
    ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      err += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, out, err }));
    child.on("error", (e) => resolvePromise({ code: 1, out: "", err: String(e) }));
  });
}

if (!existsSync(vitestEntry)) {
  console.error(`coverage-gate: vitest entry missing at ${vitestEntry}`);
  process.exit(1);
}

const attempt1 = await runVitest();
if (attempt1.code === 0 || !isInfraDeath(attempt1.code, attempt1.out + attempt1.err)) {
  process.exit(attempt1.code);
}

console.error(
  `\n[coverage-gate] infra-class failure (no test failures reported); retrying once…\n`,
);
const attempt2 = await runVitest();
process.exit(attempt2.code);
