# QA Report — Recent Changes

**Date**: 2026-03-27
**Scope**: Last 5 commits on `main` (c9416eb, 4854014, be040df, 2e4e918, 3d47cb8)
**Domain**: Tonic-lang project (autoloops harness)
**Result**: **8/9 surfaces passed, 1 failed**

## Changes Under Test

| Commit | Description |
|--------|-------------|
| c9416eb | Move `examples/auto*` → `presets/auto*` as first-class presets |
| 4854014 | Preset test harness with topology consistency checks (57 tests) |
| be040df | CSV metrics export with md/csv/json output formats |
| 2e4e918 | Regex event matching (`/pattern/` syntax) for topology routing |
| 3d47cb8 | Structured logger integration with leveled output |

## Results

| # | Surface | Method | Result |
|---|---------|--------|--------|
| 1 | `tonic check .` — compiler gate | `tonic check .` | **pass** |
| 2 | Test suite (`bin/test`) | 57 tests, 0 failures, 143ms | **pass** |
| 3 | Stale `examples/auto*` refs in source | grep scan | **pass** — only in planning docs, not source |
| 4 | Preset directory completeness | ls check (12 presets × 3 files) | **pass** — 36 files confirmed |
| 5 | CSV metrics export | code review | **FAIL** — 3 bugs found |
| 6 | Regex event matching | code + test review | **pass** |
| 7 | Structured logger | code review | **pass** |
| 8 | Preset resolver paths | code review | **pass** — `presets/` only, no `examples/` fallback |
| 9 | Doc consistency | grep scan of `docs/` | **pass** — zero stale `examples/auto` refs |

## Findings

### FAIL: CSV metrics export (surface 5)

Three bugs in the CSV/JSON metrics formatter introduced in be040df:

1. **JSON numeric quoting**: All numeric values are emitted as strings (`"iteration": "1"` instead of `"iteration": 1`). Violates JSON conventions and breaks downstream numeric consumers.
2. **Float truncation**: `parse_float_or_zero()` splits on `.` and keeps only the integer part, silently discarding decimal precision.
3. **Incomplete JSON escaping**: Only `"` is escaped; `\`, `\n`, `\r` are passed through raw, producing invalid JSON if metric values contain those characters.

**Minor** (non-blocking): Markdown table cells don't escape pipe characters.

### Non-blocking gaps

- **Regex event matching**: No tests for invalid regex patterns or edge-case delimiters. Current implementation is sound but could be hardened.
- **Structured logger**: No dedicated unit tests for level filtering. Integration is clean and backward-compatible (`--verbose` → debug level works correctly).

## Methodology

- Zero external dependencies — all validation used `tonic check`, `bin/test`, grep scans, and code review.
- 9 surfaces discovered by inspector, 6 executed by executor (3 pre-validated during inspection).
- Completed in 4 iterations: inspector → planner → executor → reporter.
