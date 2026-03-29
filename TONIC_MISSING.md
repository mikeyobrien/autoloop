# TONIC_MISSING.md

Track missing Tonic stdlib capabilities that forced local workarounds.

For each entry, include:
- date
- missing stdlib capability
- where the workaround was added
- the workaround used
- desired stdlib support
- status

Source annotations use the `# TONIC_MISSING: <capability>` comment convention. Place the annotation above the workaround site so it is discoverable via `grep -r "TONIC_MISSING:" src/`.

## Entries

### Regex

- **Date:** 2026-03-28
- **Missing capability:** `Regex` module — no native regular expression matching
- **Workaround location:** `src/topology.tn` (lines 350–410, `regex_match/2` and helpers)
- **Workaround:** Shells out to `grep -qE` via `System.run/1` with `LoopUtils.shell_quote` for safe argument escaping
- **Desired stdlib support:** Native `Regex.match?/2` function
- **Status:** Open

### Native compile list/tuple helpers

- **Date:** 2026-03-28
- **Missing capability:** Native compile output omitted `tn_runtime_length` / `tn_runtime_elem` helpers needed by generated Enum code for list/tuple access
- **Workaround location:** `scripts/build-release.sh` (removed)
- **Workaround:** Formerly patched generated `.tonic/build/main.c` with local helper shims and recompiled it with `${CC:-cc}` after `tonic compile` failed
- **Desired stdlib support:** Native compile should emit and declare the required list/tuple runtime helpers without repo-local patching
- **Status:** Resolved in tonic commit `2004243`; local consumer workaround removed

### Native compiled string host parity

- **Date:** 2026-03-28
- **Missing capability:** Standalone native binaries currently hit missing string host/runtime coverage on real loop paths (currently reproduced as `unknown host function: str_length` during loop execution)
- **Workaround location:** `scripts/release-smoke.sh`
- **Workaround:** Release smoke currently validates the standalone binary bootstrap/help path instead of full loop execution; `scripts/compiled-run-check.sh <compiled-binary>` now captures the real run-path behavior separately and currently reproduces the `str_length` host error
- **Desired stdlib support:** Native compiled binaries should support the string host/runtime surface needed for normal miniloops CLI execution, including real run-path smoke tests
- **Status:** Open; reproduced on 2026-03-29 with `scripts/compiled-run-check.sh /tmp/miniloops-release-bin` (exit 2, `error: host error: unknown host function: str_length`)

### Streaming JSON parser

- **Date:** 2026-03-29
- **Missing capability:** Safe iterative JSON stream parsing helpers for large line-oriented tool output
- **Workaround location:** `src/pi_adapter.tn` (`build_pi_bridge_command/3`, `bridge_script/0`)
- **Workaround:** Shells out to `python3` to run `pi`, capture its JSONL stream, write the raw stream log, and parse message/tool events without recursive Tonic string walkers that overflow on larger responses
- **Desired stdlib support:** Native non-recursive JSON decode plus iterable/string traversal primitives that can safely process large streams in-process
- **Status:** Open
