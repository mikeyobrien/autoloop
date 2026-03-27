# Task: Promote Auto Workflows To First-Class Presets With Canonical CLI Representation

## Description
Rename the current `examples/auto*` workflow directories into first-class `presets/auto*` bundles and represent them explicitly in the CLI as presets rather than example paths. The implementation must make preset names the canonical interface, keep the filesystem layout simple and inspectable, and remove all fallback and deprecation behavior during the transition.

## Background
Miniloops already talks about these workflow bundles as presets in docs and chain composition, but the implementation still leaks `examples/<name>` as the backing path. That makes the product model muddy: users see “preset” in docs but the runtime still treats the canonical location like a demo/example directory.

The intended model is:
- a **preset** is a named workflow bundle such as `autocode` or `autoresearch`
- a **config** is runtime configuration such as `miniloops.toml`
- a **chain** is composition of presets such as `autocode -> autoqa`

This repo is alpha software. Breaking changes are expected. The change should therefore be clean and direct:
- no fallback resolution from `presets/` back to `examples/`
- no deprecation warnings or transitional aliases
- no dual support for old and new canonical paths unless explicitly requested

The CLI should make presets feel first-class rather than incidental path conventions.

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `/Users/rook/AGENTS.md`
- Design: `README.md`
- Design: `docs/auto-workflows.md`
- Design: `chains.toml`
- Design: `src/main.tn`
- Design: `src/chains.tn`
- Design: `src/harness.tn`

**Additional References (if relevant to this task):**
- `docs/dynamic-chains.md`
- `examples/autocode/README.md`
- `examples/autoideas/README.md`
- `examples/autoresearch/README.md`
- other `examples/auto*/README.md` files that need to move or be rewritten under the new preset layout

**Note:** Follow the new repo rule: do not leave compatibility layers, fallback paths, deprecation shims, or legacy aliases behind. Make one canonical preset model and update the repo to match it.

## Technical Requirements
1. Rename the built-in workflow bundles from `examples/auto*` to `presets/auto*`.
2. Treat `presets/<name>` as the only built-in canonical location for named presets.
3. Represent preset selection explicitly in the CLI, for example with `miniloops run --preset <name> ...` and related preset-oriented commands if needed.
4. Preserve support for explicit filesystem paths when a user intentionally passes a path, but do not treat legacy `examples/<name>` resolution as a supported compatibility path.
5. Update chain resolution so named steps resolve through the canonical preset model rather than hardcoded `examples/<name>` assumptions.
6. Prefer preset discovery from the canonical preset directory over duplicated hardcoded vocabulary lists where practical.
7. Keep preset bundles as plain inspectable directories containing existing runtime files such as `miniloops.toml`, `topology.toml`, `harness.md`, `hyperagent.md`, and `roles/`.
8. Update docs, examples, and help text so the product language consistently says presets and points to `presets/` rather than `examples/`.
9. Remove or rewrite code, docs, and comments that describe the old `examples/<name>` convention as canonical.
10. Do not add deprecation warnings, migration branches, fallback resolvers, alias maps, or dual-path support.
11. Keep the implementation small and inspectable; avoid introducing a registry service, plugin system, or opaque install mechanism.
12. Validate with `tonic check .` and any targeted checks needed for CLI parsing and chain resolution.

## Dependencies
- Existing preset workflow bundles under `examples/auto*`
- Existing CLI parsing and dispatch in `src/main.tn`
- Existing chain loading and preset resolution in `src/chains.tn`
- Existing repo tenets around inspectability, explicit files, narrow core, and rich presets
- Existing docs that already describe these workflows as presets

## Implementation Approach
1. Introduce a single canonical built-in preset root at `presets/` and move the built-in auto workflows there.
2. Add or refactor preset resolution logic so preset names map to `presets/<name>` as the built-in source of truth.
3. Update CLI parsing so preset choice is explicit and user-facing rather than inferred from the old example path convention.
4. Update chain parsing and resolution to use the same preset resolver.
5. Replace remaining references to `examples/<name>` in docs, comments, help text, and chain documentation.
6. Remove any code paths or assumptions that preserve the old `examples/` convention as runtime behavior.
7. Run validation and tighten any tests or checks that cover preset naming and chain execution.

## Acceptance Criteria

1. **Built-In Presets Live Under presets/**
   - Given the repository after the change
   - When a reader inspects the built-in workflow bundles
   - Then the canonical built-in presets live under `presets/auto*` rather than `examples/auto*`

2. **CLI Exposes Presets As A First-Class Concept**
   - Given a user who wants to run a built-in workflow
   - When they inspect the CLI usage or help text
   - Then the interface presents presets explicitly rather than requiring knowledge of example directory paths

3. **Named Preset Resolution Uses The Canonical Path Only**
   - Given a named preset such as `autocode`
   - When the runtime resolves it
   - Then it resolves through the canonical `presets/autocode` location and not through `examples/autocode`

4. **Chains Use The Same Preset Model**
   - Given a `chains.toml` step list such as `steps = ["autocode", "autoqa"]`
   - When the chain runs
   - Then each named step resolves through the canonical preset resolver and executes correctly

5. **No Fallback Or Deprecation Paths Remain**
   - Given the implementation after the rename
   - When the codebase is reviewed
   - Then there are no fallback resolvers, deprecation warnings, compatibility aliases, or dual-support branches preserving the old `examples/` convention

6. **Docs Match Runtime Reality**
   - Given the updated docs and comments
   - When a reader looks for where presets live and how to invoke them
   - Then the language, examples, and file paths consistently describe first-class presets under `presets/`

7. **Explicit Path Usage Still Works Without Legacy Magic**
   - Given a user who passes an explicit preset directory path
   - When they run the CLI against that path
   - Then it works as an explicit path invocation without relying on legacy built-in fallback behavior

8. **Implementation Stays Simple**
   - Given the final design
   - When reviewed against repo tenets
   - Then it uses plain directories and resolver logic rather than introducing a new plugin or registry subsystem

9. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it completes successfully

## Metadata
- **Complexity**: Medium
- **Labels**: miniloops, presets, cli, chains, naming, information-architecture, alpha-breaking-change
- **Required Skills**: CLI design, information architecture, Tonic app development, documentation refactoring, resolver design
