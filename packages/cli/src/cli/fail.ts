// Shared error-reporting contract for every CLI error path.
//
// Errors are diagnostics, so they go to stderr — stdout stays reserved for
// requested data (`--json` consumers must never have to filter error lines
// out of a pipe). Every failure also sets a non-zero exit code so callers
// can branch on `$?` instead of scraping output.
//
// Exit-code dictionary (documented in `autoloop capabilities` and --help):
//   0  success
//   1  user-input error (unknown command/flag, missing argument, bad preset)
//   2  environment/state error (missing backend, unwritable state dir)

import { didYouMean } from "./suggest.js";

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_ENV = 2;

/** Write one or more diagnostic lines to stderr and set the exit code. */
export function fail(
  lines: string | string[],
  code: number = EXIT_USAGE,
): void {
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    process.stderr.write(`${line}\n`);
  }
  if ((process.exitCode ?? 0) === 0) process.exitCode = code;
}

/**
 * Standard "unknown <thing>" failure: names what was wrong, suggests the
 * closest valid spelling, and points at the exact command that lists the
 * valid options. Returns so callers can follow with usage output if wanted.
 */
export function failUnknown(opts: {
  kind: string;
  input: string;
  candidates: string[];
  helpCommand: string;
}): void {
  const lines = [`error: unknown ${opts.kind} \`${opts.input}\``];
  const hint = didYouMean(opts.input, opts.candidates);
  if (hint) lines.push(hint);
  lines.push(`Run \`${opts.helpCommand}\` to see valid options.`);
  fail(lines);
}

/** Standard missing-argument failure with the exact usage line to copy. */
export function failMissingArg(usageLine: string, what: string): void {
  fail([`error: missing required ${what}`, `Usage: ${usageLine}`]);
}
