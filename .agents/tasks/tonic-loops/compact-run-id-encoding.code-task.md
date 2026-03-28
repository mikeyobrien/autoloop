# Task: Compact Run ID Encoding

## Description
Generate shorter, more readable run IDs using base-36 encoding via the tonic stdlib `Integer` module instead of the current monotonic counter scheme (`"run-N"`, `"chain-N"`). Optionally support hex-encoded short IDs via the `Hex` module.

## Background
Miniloops currently generates run IDs as monotonic counters: `next_run_id/1` in `src/harness.tn` (line 1114) counts `loop.start` events and produces `"run-1"`, `"run-2"`, etc. Similarly, `next_chain_run_id/1` in `src/chains.tn` (line 354) counts `chain.start` events and produces `"chain-1"`, `"chain-2"`, etc. These IDs are short but have drawbacks: they collide if the journal is reset or truncated, they carry no timestamp information, and they can't be correlated across machines or journal files.

The tonic stdlib now includes `Integer.to_string(n, base)` (two-arg overload) for base-2..36 conversion and `Hex.encode` for hex encoding. A timestamp-based ID encoded in base-36 would be ~8-10 characters, globally unique within a machine, and carry embedded temporal ordering.

## Reference Documentation
**Required:**
- `src/harness.tn` — `next_run_id/1` (line 1114): `"run-" <> to_string(count_topic(read_lines(path), "loop.start", 0) + 1)`. Used by `run_loop/1` (line 77) to set `run_id` in loop state. Referenced throughout for journal filtering (`read_run_lines`, `filter_run_lines`, etc.).
- `src/chains.tn` — `next_chain_run_id/1` (line 354): `"chain-" <> to_string(count_chain_starts(read_lines(journal_file), 0) + 1)`. Used for chain directory names and chain journal events.
- Tonic stdlib Integer module:
  - `Integer.to_string(n, base) -> string` — base 2..36, lowercase a-z for 10-35 (two-arg overload)
  - `Integer.to_string(n) -> string` — decimal string (one-arg overload)
  - `Integer.parse(str) -> integer` — parse leading integer from string
- Tonic stdlib Hex module:
  - `Hex.encode(binary) -> string` — lowercase hex encoding
  - `Hex.decode(hex_string) -> binary` — decode hex string

**Additional References:**
- `src/main.tn` — inspect views showing run IDs
- `src/memory.tn` — memory entry IDs (separate scheme, not changed)
- `docs/journal.md` — documents `"run"` field format as `"run-1"` etc.

## Technical Requirements
1. Add a `generate_compact_id(prefix)` helper that produces a compact, human-friendly ID with the given prefix.
2. The ID format should be: `<prefix>-<base36_timestamp>-<base36_random_suffix>`, e.g., `run-k7f3x2-a9m` or `chain-k7f3x2-b2p`. Total length ~16-20 characters.
3. Use `DateTime.utc_now()` or equivalent to get a millisecond timestamp, then `Integer.to_string(timestamp_ms, 36)` for the time component.
4. Use a short random suffix (3-4 base-36 characters) for uniqueness within the same millisecond.
5. Replace `next_run_id/1` in `src/harness.tn` to call `generate_compact_id("run")` instead of the counter pattern.
6. Replace `next_chain_run_id/1` in `src/chains.tn` to call `generate_compact_id("chain")` instead of the counter pattern.
7. Keep memory entry IDs unchanged — they use a different ID scheme.
8. Ensure the new IDs are safe for use in file paths (no `/`, `\`, or special characters — base-36 + hyphen are all safe).
9. Add a `core.run_id_format` config key with values `"compact"` (default) and `"counter"` for users who prefer the existing sequential `"run-N"` / `"chain-N"` format.
10. Update journal read/filter paths to be format-agnostic — `extract_run/1` and `filter_run_lines/3` already match on exact string equality, so they should work with any ID format without changes.
11. The `latest_run_id/1` function (line 1096) scans for the most recent `loop.start` event's run field — verify it works with non-numeric suffixes.

## Acceptance Criteria
- New run IDs follow the format `run-<base36>-<suffix>`, e.g., `run-k7f3x2p-a9m`.
- New chain IDs follow the format `chain-<base36>-<suffix>`, e.g., `chain-k7f3x2p-b2p`.
- IDs are unique across runs on the same machine (timestamp + random suffix).
- Journal entries, chain directories, and inspect output use the new compact IDs.
- Setting `core.run_id_format = "counter"` falls back to the existing `"run-N"` / `"chain-N"` scheme.
- Existing journal files with counter-based run IDs continue to parse and render correctly (read path is format-agnostic).
- `docs/journal.md` is updated to document the new ID format.

## Dependencies
- Tonic runtime with Integer and Hex modules available in stdlib
- Existing run ID generation in harness (`next_run_id/1`) and chains (`next_chain_run_id/1`)
