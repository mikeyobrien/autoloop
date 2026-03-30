# Bug Report

## Current Bug
Metrics summary truncates decimal elapsed times instead of preserving float precision.

## Source
`qa-report.md` surface 5, bug 2: float truncation in `parse_float_or_zero()`.

## Reproduction
Command used:
```sh
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/.autoloops"
cat > "$tmpdir/.autoloops/journal.jsonl" <<'EOF'
{"run": "run-1", "topic": "loop.start", "fields": {}}
{"run": "run-1", "iteration": "1", "topic": "iteration.start", "fields": {"suggested_roles": "worker"}}
{"run": "run-1", "iteration": "1", "topic": "iteration.finish", "fields": {"exit_code": "0", "timed_out": false, "elapsed_s": "1.9", "output": ""}}
{"run": "run-1", "iteration": "2", "topic": "iteration.start", "fields": {"suggested_roles": "worker"}}
{"run": "run-1", "iteration": "2", "topic": "iteration.finish", "fields": {"exit_code": "0", "timed_out": false, "elapsed_s": "2.4", "output": ""}}
EOF
env MINILOOPS_JOURNAL_FILE="$tmpdir/.autoloops/journal.jsonl" \
    MINILOOPS_RUN_ID=run-1 \
    /Users/rook/projects/tonic-loops/bin/autoloops inspect metrics --format md
```

Observed output:
```md
| iteration | role | event | elapsed_s | exit_code | timed_out | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | worker | none | 1.9 | 0 | }} | continue |
| 2 | worker | none | 2.4 | 0 | }} | continue |

**Summary:** 2 iterations, 3s total elapsed, 0 distinct events
```

Expected summary total: `4.3s total elapsed`.

Minimum requirement for this bug: metrics summary must not discard the fractional part of `elapsed_s` values.

## Root Cause
`src/harness.tn` computes the summary via `sum_elapsed/2`, which calls `parse_float_or_zero/1`. That helper splits the string on `.` and keeps only the integer part before delegating to `parse_int_or_zero/1`, so `1.9` becomes `1` and `2.4` becomes `2`.

Relevant code:
- `sum_elapsed/2`
- `parse_float_or_zero/1`
- `parse_int_or_zero/1`

## Scope Guard
Fix only elapsed-time summary precision for metrics output in this step. Do not refactor unrelated metrics formatting.

## Status
Verified. `tonic check .` passed, `bin/test` passed (`61 passed; 0 failed; 61 total`), and the reproduction now reports `**Summary:** 2 iterations, 4.3s total elapsed, 0 distinct events`.
