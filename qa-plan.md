# QA Plan — Recent Changes (last 5 commits)

## Domain
Tonic-lang project (`miniloops`): a shell+Tonic harness for autonomous LLM loops.

## Recent Changes
1. **c9416eb** — Move `examples/auto*` → `presets/auto*` as first-class presets; update resolvers, docs, tests
2. **4854014** — Preset test harness: topology helpers, 57 tests, `bin/test` runner
3. **be040df** — CSV metrics export with md/csv/json output formats
4. **2e4e918** — Regex event matching (`/pattern/` syntax) for topology routing
5. **3d47cb8** — Structured logger integration with leveled output (debug/info/warn/error)

## Discovered Validation Surfaces

| # | Surface | Tool | Status |
|---|---------|------|--------|
| 1 | `tonic check .` — compiler/type check | `tonic check .` | **passed** (inspector pre-check) |
| 2 | Test suite — 57 tests covering topology, config, presets, memory | `bin/test` | pending |
| 3 | Stale `examples/auto*` refs in source code | grep scan | **passed** — only in .agents/tasks + planning docs, not source |
| 4 | Preset directory completeness — 12 presets × {miniloops.toml, topology.toml, harness.md} | ls check | **passed** — 36 files confirmed |
| 5 | CSV metrics export — public API callable, format correctness | runtime smoke or test review | pending |
| 6 | Regex event matching — pattern syntax, anchoring, edge cases | test review + optional smoke | pending |
| 7 | Structured logger — level parsing, backward compat (--verbose → debug) | code review + test check | pending |
| 8 | Preset resolver — `presets/` path used in config.tn, no `examples/` fallback | code review | pending |
| 9 | Doc consistency — docs reference `presets/` not `examples/` | grep scan | pending |

## Ordered Steps
1. Run `bin/test` (surface 2)
2. Review CSV metrics export code + check for test coverage (surface 5)
3. Review regex event matching tests for edge-case coverage (surface 6)
4. Review structured logger for level parsing + backward compat (surface 7)
5. Verify preset resolver paths in config.tn — no examples/ fallback (surface 8)
6. Grep docs/ for stale `examples/auto` references (surface 9)
