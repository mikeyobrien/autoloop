# Context: Implement pending .agents/tasks

## Objective
Implement the 16 pending code-task specs in `.agents/tasks/tonic-loops/`. All are currently unimplemented. Work proceeds one slice at a time in dependency order.

## Current State
- Core harness, config, memory, chains, topology, PI adapter, JSON, and utils modules are implemented in `src/*.tn`.
- Tests exist in `test/config_test.tn` and `test/memory_test.tn`.
- Chain definitions in `chains.toml` with 6 example chains.
- Preset resolution uses bundled `examples/` directories.
- Config uses flat dotted-key strings parsed from `miniloops.toml`.
- No structured logging, no regex event matching, no store-backed state, no run isolation.

## Constraints
- One concrete slice at a time.
- Each slice committed before handoff.
- Verification mandatory before review.
- Prefer small, verifiable changes.
