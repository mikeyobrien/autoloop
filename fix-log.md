# Fix Log

## Bug 1 — metrics JSON typed fields

### Changes applied
- Updated `src/harness.tn` so `inspect metrics --format json` emits:
  - `iteration`, `elapsed_s`, `exit_code` as JSON numbers when present
  - `elapsed_s`, `exit_code` as `null` when absent
  - `timed_out` as a JSON boolean
- Added regression coverage in `test/harness_test.tn` for unquoted numeric/boolean metrics fields.
- Hardened the harness tests to clear inherited `MINILOOPS_*` env vars before spawning fixture runs/inspections, so fixture assertions use their own journal instead of the live autofix loop journal.

### Verification
- `tonic check .`
  - Output: `check: ok`
- `bin/test`
  - Output: `test result: ok. 60 passed; 0 failed; 60 total`
- `./bin/miniloops inspect metrics --format json | head -n 5`
  - Output: `[{"iteration": 1, "role": "diagnoser", "event": "cause.found", "elapsed_s": 82, "exit_code": 0, "timed_out": false, "outcome": "emitted"}, {"iteration": 2, "role": "fixer", "event": "fix.applied", "elapsed_s": 266, "exit_code": 0, "timed_out": false, "outcome": "emitted"}, {"iteration": 3, "role": "verifier", "event": "none", "elapsed_s": null, "exit_code": null, "timed_out": false, "outcome": "continue"}]`
- Re-ran verification in verifier turn:
  - `tonic check .` → `check: ok`
  - `bin/test` → `test result: ok. 60 passed; 0 failed; 60 total`

### Closure
- Bug 1 closed.
- Next queued issue from `.miniloop/qa-report.md`: bug 2, float truncation in `parse_float_or_zero()`.

## Bug 2 — metrics summary decimal precision

### Changes applied
- Updated `src/harness.tn` so metrics markdown summary totals are summed with decimal precision instead of truncating at `.` before addition.
- Added regression coverage in `test/harness_test.tn` with a synthetic journal containing `elapsed_s` values `1.9` and `2.4`; the summary now has to report `4.3s total elapsed`.

### Commands run
- `tonic check .`
  - Output: `check: ok`
- `bin/test`
  - Output: `test result: ok. 61 passed; 0 failed; 61 total`
- Reproduction from `bug-report.md`
  - Output summary: `**Summary:** 2 iterations, 4.3s total elapsed, 0 distinct events`

### Verification
- `tonic check .`
  - Output: `check: ok`
- `bin/test`
  - Output: `test result: ok. 61 passed; 0 failed; 61 total`
- Reproduction from `bug-report.md`
  - Output summary: `**Summary:** 2 iterations, 4.3s total elapsed, 0 distinct events`

### Notes
- Verification re-ran the full gate and the focused reproduction; bug 2 is ready to close.
- The markdown row rendering still shows `timed_out` as `}}` in this synthetic repro, but bug 2's required summary precision fix is verified and that separate formatting issue is out of scope for this step.
