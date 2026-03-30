# Task: Regex-Powered Event Matching

## Description
Add optional regex pattern-based event matching to topology routing. Allow `emits` entries and `handoff` keys in `topology.toml` to use regex patterns (delimited by `/`) alongside exact string matches. This enables flexible event routing without enumerating every possible event name.

## Background
Autoloops topology currently uses exact string matching for event validation and handoff routing. A role's `emits` list must contain the literal event topic, and `[handoff]` keys must be exact event names. This works for small topologies but becomes verbose when events follow naming conventions (e.g., `review.passed`, `review.rejected`, `review.deferred`).

The tonic stdlib now includes a `Regex` module with `Regex.match?(string, pattern)` and related functions. Adding optional regex patterns to topology routing lets preset authors write compact event matching rules while keeping exact strings as the default.

## Reference Documentation
**Required:**
- `src/topology.tn` — role deck loading, `suggested_roles`, `allowed_events`, `render`
- `src/harness.tn` — `emit` validation logic, `accept_emit`/`reject_emit`
- Tonic stdlib Regex module:
  - `Regex.match?(string, pattern) -> bool` — test if string matches pattern
  - Uses Rust regex syntax
  - Invalid patterns return error with message

**Additional References:**
- `examples/autocode/topology.toml` — example topology file
- `src/config.tn` — for understanding config patterns

## Technical Requirements
1. In `src/topology.tn`, detect regex patterns in `emits` arrays and `[handoff]` keys by checking for `/pattern/` delimiters (leading and trailing `/`).
2. Add a helper `event_matches?(topic, pattern_or_literal)` that:
   - If the value starts and ends with `/`, strips delimiters and calls `Regex.match?(topic, inner_pattern)`.
   - Otherwise, performs exact string equality (current behavior).
3. Update `allowed_events(topology, recent_event)` to return a mixed list of literals and patterns. The emit validator in harness must accept topics that match any pattern.
4. Update `suggested_roles(topology, recent_event)` to check handoff keys using `event_matches?` so a single regex key can route multiple events to the same roles.
5. Update the `emit` validation path in `src/harness.tn` to use `event_matches?` when checking the topic against allowed events.
6. Update `render(topology, recent_event)` to display regex patterns distinctly (e.g., with the `/` delimiters preserved) so users can see which entries are patterns vs. literals.
7. Handle invalid regex patterns gracefully: log a warning via Logger and skip the pattern (treat as non-matching), rather than crashing.
8. Keep exact string matching as the default and primary path. Regex is opt-in per entry.
9. Document the regex pattern syntax in a brief comment block in `topology.tn`.

## Acceptance Criteria
- A topology with `emits = ["/review\\..+/"]` accepts events like `review.passed`, `review.rejected`.
- A handoff key `"/build\\..+/" = ["builder"]` routes `build.started`, `build.blocked` to builder.
- Exact string entries continue to work unchanged.
- Invalid regex patterns produce a warning and are skipped, not a crash.
- `autoloops inspect coordination` renders regex patterns with `/` delimiters.

## Dependencies
- Tonic runtime with Regex module available in stdlib
- Existing topology loading and harness emit validation
- Slice 1 (structured-logger-integration) for Logger.warn on invalid patterns (can use verbose_log as fallback if Logger not yet integrated)
