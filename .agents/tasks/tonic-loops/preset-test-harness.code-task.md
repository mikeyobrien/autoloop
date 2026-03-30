# Task: Preset Test Harness

## Description
Add `.tn` test files for preset validation — config parsing, topology loading, prompt assembly, and role/event contract checking. Leverage tonic's enhanced test command with `--filter`, `--fail-fast`, and `--timeout` for CI integration.

## Background
Autoloops presets (e.g., `examples/autocode/`) are workflow bundles with topology, config, role prompts, and harness instructions. Currently there are no automated tests verifying that presets load correctly, that their topologies are internally consistent (all emitted events have handoff entries, all handoff targets exist as roles), or that prompt assembly produces expected output.

The tonic test command now supports `--filter <pattern>` for substring filtering, `--fail-fast` for early termination, `--seed <n>` for randomized ordering, and `--timeout <ms>` for per-test limits. These features make it practical to build a test suite that runs in CI.

## Reference Documentation
**Required:**
- `src/config.tn` — `load_project`, config defaults and parsing
- `src/topology.tn` — `load`, role/handoff consistency
- `src/harness.tn` — prompt assembly (`render_iteration_prompt_text`)
- Tonic test command:
  - `tonic test <path> [--filter <pattern>] [--fail-fast] [--seed <n>] [--timeout <ms>] [--format text|json]`
  - Test modules discovered by convention (files matching `*_test.tn` or `test_*.tn`)
  - `setup/0` and `teardown/0` optional per-module hooks
  - Test functions: `test_<name>/0`

**Additional References:**
- `examples/autocode/topology.toml` — example preset topology
- `examples/autocode/autoloops.toml` — example preset config
- `examples/autocode/roles/*.md` — example role prompts
- `examples/autocode/harness.md` — example harness instructions

## Technical Requirements
1. Create a `test/` directory at the project root for test files.
2. Add `test/config_test.tn` with tests for:
   - Loading a valid `autoloops.toml` produces expected config map.
   - Default values are present for all required keys.
   - `get`, `get_int`, `get_list` return correct types.
   - Missing config file returns defaults gracefully.
3. Add `test/topology_test.tn` with tests for:
   - Loading a valid `topology.toml` produces a topology with roles, handoff, and completion event.
   - All events in `emits` arrays have corresponding `[handoff]` entries (consistency check).
   - All role IDs referenced in `[handoff]` values exist in the role deck.
   - `suggested_roles` and `allowed_events` return correct values for known events.
   - Missing topology file returns a sensible default.
4. Add `test/preset_test.tn` with tests for:
   - Each preset directory under `examples/` (or `presets/` if renamed) loads without errors.
   - Each preset's topology is internally consistent.
   - Each role referenced in topology has a corresponding prompt file or inline prompt.
   - Prompt assembly for iteration 1 produces non-empty output.
5. Add `test/harness_test.tn` with tests for:
   - `render_iteration_prompt_text` includes objective, topology, iteration count, and event tool path.
   - Scratchpad rendering handles empty and multi-iteration journals.
   - Coordination event parsing extracts correct fields.
6. Use `setup/0` hooks to create temporary directories with test fixtures (config files, topology files) rather than depending on the live project state.
7. Add a `Makefile` target or script for `tonic test test/ --fail-fast --timeout 10000`.
8. Document test patterns in a brief comment at the top of each test file.

## Acceptance Criteria
- `tonic test test/` runs all tests and reports pass/fail.
- `tonic test test/ --filter topology` runs only topology tests.
- `tonic test test/ --fail-fast` stops on first failure.
- All shipped presets pass the preset consistency tests.
- Tests do not depend on network, external services, or the PI backend.
- Tests run in under 10 seconds total.

## Dependencies
- Tonic runtime with enhanced test command (--filter, --fail-fast, --timeout)
- Existing config, topology, and harness modules as test subjects
- Preset directories with valid config and topology files
