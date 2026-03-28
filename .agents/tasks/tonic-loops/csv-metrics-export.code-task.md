# Task: CSV Metrics Export

## Description
Add `miniloops inspect metrics --format csv` to export iteration timing, role assignments, event counts, and completion status as CSV using the tonic stdlib `CSV` module. Also support `--format json` and `--format md` (default).

## Background
Miniloops already records structured data in the journal (JSONL): iteration start/finish times, backend elapsed seconds, emitted events, role assignments, and completion outcomes. However, extracting this data for analysis requires manual JSONL parsing. A metrics inspect command that aggregates journal data into tabular form makes run analysis accessible to spreadsheets, dashboards, and scripts.

The tonic stdlib now includes a `CSV` module with `CSV.encode(rows)` and `CSV.encode_maps(headers, maps)` for generating RFC 4180-compliant CSV output.

## Reference Documentation
**Required:**
- `src/harness.tn` — journal format, `render_journal`, `render_coordination`, `extract_*` helpers
- `src/main.tn` — `dispatch_inspect` for adding new inspect targets
- Tonic stdlib CSV module:
  - `CSV.encode(rows: list[list]) -> string` — encode rows to CSV
  - `CSV.encode_maps(headers: list, maps: list[map]) -> string` — encode maps with header row
  - Quotes fields containing commas, quotes, or newlines
  - nil values → empty string

**Additional References:**
- `src/config.tn` — for understanding config patterns
- `src/chains.tn` — chain metrics if applicable

## Technical Requirements
1. Add a `render_metrics(project_dir, format)` function to `src/harness.tn` (or a new `src/metrics.tn` module if harness is already large).
2. Parse the journal JSONL to extract per-iteration metrics:
   - `iteration` — iteration number
   - `role` — role assigned for that iteration
   - `event` — event emitted (or "none" / "invalid")
   - `elapsed_s` — backend elapsed time from `iteration.finish`
   - `exit_code` — backend exit code
   - `timed_out` — boolean
   - `outcome` — "continue", "complete", "rejected", "timeout", "failed"
3. Add summary row or section with:
   - Total iterations
   - Total elapsed time
   - Distinct events emitted
   - Completion status (completed/stopped/max_iterations)
4. Add `"metrics"` as a new inspect target in `dispatch_inspect` in `src/main.tn`.
5. Support three output formats:
   - `--format md` (default) — markdown table
   - `--format csv` — CSV via `CSV.encode_maps(headers, rows)`
   - `--format json` — JSON array of row maps via `Json.encode`
6. CSV output should use headers: `iteration,role,event,elapsed_s,exit_code,timed_out,outcome`.
7. Handle missing or incomplete journal data gracefully (e.g., a run interrupted mid-iteration should show partial data).
8. Scope metrics to the most recent run by default. Add `--run <run_id>` flag to inspect a specific run.

## Acceptance Criteria
- `miniloops inspect metrics` prints a markdown table of per-iteration metrics.
- `miniloops inspect metrics --format csv` prints valid RFC 4180 CSV.
- `miniloops inspect metrics --format json` prints a JSON array.
- `miniloops inspect metrics --run <id>` scopes to a specific run.
- Partial/interrupted runs show available data without crashing.
- CSV output can be imported into a spreadsheet and parsed correctly.

## Dependencies
- Tonic runtime with CSV and Json modules available in stdlib
- Existing journal format and JSONL extraction helpers in harness
- Existing inspect dispatch in main.tn
