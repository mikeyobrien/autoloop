# Task: Structured Logger Integration

## Description
Replace the ad-hoc `verbose_log` pattern in `src/harness.tn` with tonic's stdlib `Logger` module. Add a `log_level` config key so users can control verbosity. Surface the active log level in inspect output and the iteration prompt footer.

## Background
Autoloops currently uses a `verbose_log(loop, message)` helper (line 1784) that checks a boolean `verbose` flag and writes to **stdout** via `IO.puts("[verbose] " <> message)` (line 1786). This is binary (on/off) and lacks severity levels. The tonic stdlib now ships a `Logger` module with `debug/info/warn/error` functions and a global level filter (`set_level/get_level`). Adopting it gives autoloops leveled logging with no custom plumbing.

**Important behavioral change:** The current `verbose_log` writes to **stdout** (`IO.puts`), while the tonic `Logger` module writes to **stderr**. This is an intentional improvement — log output mixed into stdout can interfere with pipe-based workflows and inspect output parsing. However, any tooling or scripts that capture verbose output from stdout will need updating.

The migration should be conservative: every existing `verbose_log` call maps to an appropriate Logger level, the default level stays `:info` (matching current non-verbose behavior), and `--verbose` maps to `:debug` for backward compatibility.

## Reference Documentation
**Required:**
- `src/harness.tn` — `verbose_log/2` (line 1784): checks `verbose(loop)` (line 1780), calls `IO.puts("[verbose] " <> message)` on stdout. Called at: loop start (line 9), iteration start/finish (lines 183, 196), backend start (line 185), loop stop/complete (lines 288, 295, 304, 313).
- `src/config.tn` — config loading and defaults
- `src/main.tn` — CLI parsing: `--verbose` flag at lines 305-310, defaults `verbose: false` at lines 331, 339, 344-345, 351-352, 408.
- Tonic stdlib Logger module: `Logger.debug/info/warn/error`, `Logger.set_level/get_level`
  - Levels: `:debug < :info < :warn < :error < :none`
  - Messages written to **stderr** (this is a change from current stdout-based `verbose_log`)
  - Default level: `:info`

**Additional References:**
- `src/topology.tn` — may have verbose_log calls
- `src/chains.tn` — may have verbose_log calls
- `src/memory.tn` — may have verbose_log calls

## Technical Requirements
1. Add `core.log_level` config key to `src/config.tn` defaults, defaulting to `"info"`.
2. In the run entry point (`src/harness.tn` or `src/main.tn`), call `Logger.set_level(level_atom)` using the resolved log level before entering the iteration loop.
3. Map `--verbose` CLI flag to `:debug` log level for backward compatibility. If both `--verbose` and `core.log_level` are set, `--verbose` wins.
4. Replace every `verbose_log(loop, msg)` call with the appropriate `Logger.debug(msg)`, `Logger.info(msg)`, `Logger.warn(msg)`, or `Logger.error(msg)` based on the message's semantic severity:
   - Iteration lifecycle messages (start, finish, reload) → `Logger.debug`
   - Backend invocation and result → `Logger.info`
   - Event validation warnings, backpressure → `Logger.warn`
   - Timeout, backend failure, fatal errors → `Logger.error`
5. Remove the `verbose_log` helper function and the `verbose` field from the loop state map.
6. Surface the active log level in `render_coordination` or `render_prompt` inspect output so users can verify what level is active.
7. Ensure existing tests still pass — the Logger writes to stderr, which should not interfere with stdout-based assertions.
8. Do not change the journal or event format. Logger output is ephemeral stderr, not persisted state.

## Acceptance Criteria
- Running with `--verbose` produces debug-level output on **stderr** (same messages as before, routed through Logger — note: this is an intentional change from the previous stdout-based `verbose_log`).
- Running without `--verbose` produces only info+ messages on stderr.
- Setting `core.log_level = "warn"` in `autoloops.toml` suppresses info and debug output.
- `autoloops inspect prompt <N>` shows the active log level.
- No `verbose_log` references remain in the codebase.
- The `verbose` field is removed from the loop state map; `--verbose` is translated to `log_level: :debug` at CLI parse time.

## Dependencies
- Tonic runtime with Logger module available in stdlib
- Existing config, harness, and CLI infrastructure
