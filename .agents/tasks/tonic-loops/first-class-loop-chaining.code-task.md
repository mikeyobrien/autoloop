# Task: Add First-Class Loop Chaining With chains.toml And CLI Composition

## Description
Add first-class loop chaining to autoloops as a separate orchestration layer above individual preset topology. The design should support both reusable named chains in `chains.toml` and ad hoc chain definitions from the CLI, so users can compose presets like `autocode -> autoqa -> autoresearch -> autocode` without coupling those compositions into per-preset role routing.

## Background
Autoloops already has a strong model for intra-loop orchestration:
- `topology.toml` defines roles and handoff behavior inside one preset
- the journal records runtime state for a single loop
- prompts, working files, and examples define preset-specific behavior

What is missing is a first-class way to compose whole presets together.

The key design constraint is to keep loop chaining distinct from role routing:
- `topology.toml` should remain about routing inside one loop
- loop-to-loop composition should live in a separate layer

A naive event-triggered child-loop mechanism inside `topology.toml` would be too coupled and would make chains run automatically whenever a triggering event occurs. Instead, chains should be explicit and composable:
- reusable named chains from `chains.toml`
- one-off on-the-fly chain composition from the CLI

Examples of desired workflows:
- `autocode -> autoqa`
- `autoideas -> autocode`
- `autocode -> autoqa -> autoresearch -> autocode`

The composition layer should remain simple and inspectable, with git-durable handoff/result artifacts and journaled orchestration state.

## Reference Documentation
**Required:**
- Design: `README.md`
- Design: `src/main.tn`
- Design: `src/harness.tn`
- Design: `src/config.tn`
- Design: `src/topology.tn`
- Design: `examples/autocode/README.md`
- Design: `examples/autoresearch/README.md`
- Design: `harness.md`
- Design: `hyperagent.md`
- Design: `AGENTS.md`

**Additional References (if relevant to this task):**
- `examples/autoideas/README.md`
- `examples/autoqa/` if it exists by the time this task is implemented
- current `.agents/tasks/*.code-task.md` files discussing `auto*` families or journal-first runtime simplification

**Note:** Keep loop chaining distinct from role-level topology. Do not collapse the two layers together.

## Technical Requirements
1. Add a separate first-class chain layer for composing presets, independent from `topology.toml`.
2. Support reusable named chains from a new `chains.toml` file.
3. Support ad hoc chain composition directly from the CLI without requiring file edits.
4. Allow compositions such as `autocode,autoqa,autoresearch,autocode`.
5. Resolve preset names cleanly and explicitly (for example via canonical aliases like `autocode -> examples/autocode`).
6. Preserve per-step isolation so each child loop has its own runtime state/artifact area.
7. Create git-durable handoff/result artifacts between chain steps.
8. Journal the parent chain orchestration lifecycle with structured events.
9. Keep the design minimal and inspectable; do not build a large scheduler or plugin system.
10. Keep Pi as the default real adapter for loops unless a step is explicitly overridden.
11. Avoid coupling chain execution to ordinary loop events inside `topology.toml`.
12. Validate with `tonic check .`.

## Dependencies
- Existing preset examples and naming conventions
- Existing journal-first loop runtime model
- Existing CLI parsing in `src/main.tn`
- Existing inspectability principles in `AGENTS.md`
- Existing project tenets around simple mechanisms, git-durable files, and narrow core / rich presets

## Implementation Approach
1. Define the chain model as a separate orchestration layer above loop topology.
2. Add `chains.toml` support for reusable named chains.
3. Add CLI support for inline chain definitions, for example a `--chain` flag.
4. Implement preset-name resolution using explicit aliases or documented lookup rules.
5. Add a child-loop execution primitive that runs each preset step in sequence.
6. For each step, write a structured handoff artifact and a structured result artifact.
7. Record parent-chain lifecycle events in a dedicated journal or clearly namespaced journal entries.
8. Ensure each step has its own isolated runtime state directory.
9. Update docs so users can understand the difference between:
   - a preset
   - a loop topology
   - a chain of presets
10. Keep the initial version synchronous and sequential; no parallel orchestration or heavy branching logic.

## Acceptance Criteria

1. **chains.toml Supports Named Reusable Chains**
   - Given a repo with a `chains.toml`
   - When it defines a named chain such as `autocode -> autoqa -> autoresearch -> autocode`
   - Then autoloops can execute that named chain without editing per-preset topology

2. **CLI Supports Ad Hoc Chains**
   - Given a user who does not want to edit repo files
   - When they run autoloops with an inline chain definition
   - Then the chain executes using the supplied preset sequence

3. **Topology And Chaining Stay Separate**
   - Given a preset with `topology.toml`
   - When loop chaining is added
   - Then `topology.toml` remains focused on intra-loop role routing and does not become the primary place for inter-loop composition

4. **Preset Sequences Are Explicitly Composable**
   - Given a chain like `autocode,autoqa,autoresearch,autocode`
   - When autoloops executes it
   - Then each step runs in sequence with clear handoff/result boundaries between loops

5. **Handoff And Result Artifacts Are Durable**
   - Given a chained execution
   - When one step finishes and the next begins
   - Then the handoff and result are stored in inspectable git-durable files such as markdown and/or jsonl rather than only transient runtime memory

6. **Chain Lifecycle Is Journaled**
   - Given a chained run
   - When it executes
   - Then the parent orchestration records structured lifecycle events such as chain start, per-step start/finish, and final chain outcome

7. **Per-Step State Is Isolated**
   - Given a multi-step chain
   - When the child loops run
   - Then each loop step has its own isolated state/artifact directory rather than colliding with the parent or sibling steps

8. **Docs Explain The Model Clearly**
   - Given the updated docs
   - When a reader compares presets, topologies, and chains
   - Then they can clearly understand the difference between intra-loop role flow and inter-loop preset composition

9. **The First Version Stays Simple**
   - Given the implementation
   - When reviewed
   - Then it remains synchronous, sequential, and inspectable, without introducing a large orchestration framework, plugin architecture, or complex scheduler

10. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: High
- **Labels**: autoloops, chaining, orchestration, presets, chains, cli, jsonl, markdown
- **Required Skills**: CLI design, orchestration design, event schema design, Tonic app development, information architecture, preset system design
