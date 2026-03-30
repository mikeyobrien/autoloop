# Task: Add Profiles For Preset Role Tuning

## Description
Add a first-class profile system that lets users tune shipped preset roles with extra markdown instructions without forking presets. Profiles should be append-only, role-scoped prompt fragments that can be activated from repo scope or user scope, with support for repo-defined default profiles. The implementation must keep the preset contract stable: profiles may refine how a role behaves in a given repo or runtime mode, but they must not mutate topology, emit contracts, routing, or role identity.

## Background
Autoloops already leans on plain markdown prompts, role decks, and explicit files rather than hidden workflow machinery. That makes prompt-layer customization the natural place to let users adapt presets to their repos and working styles.

The desired model is:
- a **preset** remains the canonical workflow bundle with stable topology and role/event contracts
- `AGENTS.md` remains the repo-wide source of truth for shared constraints and behavior
- a **profile** is an optional set of extra role-specific instructions layered onto a preset for a particular repo or user-selected runtime mode

Profiles need to support two scopes:
- **repo profiles** checked into the repo for shared team tuning
- **user profiles** stored outside the repo for personal reusable modes such as strict review or test-heavy behavior

The feature should stay intentionally narrow. It should not become a second preset system, a config inheritance mechanism, or a structural overlay feature. The core value is simple, inspectable prompt composition.

Key design decisions already settled:
- profiles are append-only markdown fragments
- profiles only target exact preset/role pairs in v1
- repo defaults are supported via config
- activation order is repo defaults first, then explicit CLI profiles in CLI order
- unknown-role fragments warn and are ignored
- profiles with no matching fragments warn and are ignored
- path-based profile activation is deferred to v2
- inspect support should extend the existing inspect surface rather than introducing a new top-level command

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `/Users/rook/AGENTS.md`
- Design: `README.md`
- Design: `docs/topology.md`
- Design: `docs/configuration.md`
- Design: `docs/creating-presets.md`
- Design: `src/topology.tn`
- Design: `src/harness.tn`
- Design: `src/config.tn`
- Design: `src/main.tn`

**Additional References (if relevant to this task):**
- `docs/hyperagent.md`
- `docs/journal.md`
- `examples/autocode/topology.toml`
- `examples/autocode/roles/planner.md`
- `examples/autocode/harness.md`
- other `examples/auto*/roles/*.md` files as needed to verify role naming conventions and prompt assembly behavior

**Note:** Keep the implementation prompt-first and inspectable. Do not turn profiles into a generalized preset overlay or inheritance system.

## Technical Requirements
1. Introduce a first-class profile concept for preset role tuning with two supported scopes in v1: repo and user.
2. Support repo-scoped profiles at `.autoloop/profiles/<profile>/<preset>/<role>.md`.
3. Support user-scoped profiles at `~/.config/autoloops/profiles/<profile>/<preset>/<role>.md`.
4. Support explicit profile activation in the CLI using only `repo:<name>` and `user:<name>` forms in v1.
5. Support repo default profiles via config, using a key such as `profiles.default = ["repo:phoenix"]` in `autoloops.toml`.
6. Support `--no-default-profiles` so users can suppress repo defaults for a run.
7. Define profile application order as:
   1. repo default profiles, in config order
   2. explicit CLI profiles, in CLI order
8. Keep profile behavior append-only: matching fragments are appended to the shipped role prompt in activation order.
9. Do not allow profiles to modify `topology.toml`, `autoloops.toml` behavior beyond default profile declaration, role lists, `emits`, handoff routing, or completion semantics.
10. Keep matching exact in v1: exact profile, exact preset, exact role, with no wildcard support.
11. Warn and ignore profile fragments whose filenames do not match a real role in the target preset.
12. Warn when an activated profile contributes no fragments for the target preset.
13. Fail fast with a normal user-facing error if an explicitly referenced profile directory does not exist.
14. Extend the existing inspect surface with prompt inspection that shows active default profiles, explicit profiles, final activation order, source files, warnings, and final rendered prompt.
15. Ensure prompt/debug output stays inspectable so a user can understand exactly which profile fragments were applied to a role.
16. Document clearly that `AGENTS.md` remains authoritative repo truth and profiles only tune role behavior; they do not override repo constraints.
17. Keep the implementation small and markdown-first. Avoid registries, plugin systems, structural overlay semantics, or prompt templating DSLs.
18. Add or update tests for profile resolution, ordering, prompt composition, warnings, config defaults, and inspect output.

## Dependencies
- Existing preset topology loading and role prompt loading in `src/topology.tn`
- Existing prompt assembly and iteration rendering in `src/harness.tn`
- Existing config parsing and defaults in `src/config.tn`
- Existing CLI parsing and inspect/run behavior in `src/main.tn`
- Existing documentation for config, topology, presets, and inspectability
- Existing role IDs declared in each preset’s `topology.toml`

## Implementation Approach
1. Add a small profile resolution layer that can resolve active profile references from repo scope and user scope without introducing a new registry abstraction.
2. Extend config parsing to load repo default profiles and CLI parsing to accept repeated `--profile` flags plus `--no-default-profiles`.
3. Compute the active profile list in a single place with explicit ordering: repo defaults first unless disabled, then CLI profiles.
4. Resolve the active preset’s roles from topology and validate profile fragments against real role IDs.
5. Extend role prompt assembly so each role prompt is built from the shipped prompt plus any matching profile fragments in activation order.
6. Preserve source provenance for each assembled prompt so inspect/debug output can list the exact files used.
7. Surface non-fatal warnings for unknown-role fragments and no-op profiles.
8. Surface fatal errors for missing explicitly requested profile directories.
9. Extend `inspect prompt` or equivalent existing inspect flow to render the profile-aware prompt and associated metadata.
10. Update docs to explain the profile model, scopes, activation syntax, repo defaults, ordering, warnings, and non-goals.
11. Add focused tests around config parsing, lookup rules, ordering, validation, and inspect output.

## Acceptance Criteria

1. **Repo And User Profile Scopes Work**
   - Given a repo profile at `.autoloop/profiles/phoenix/autocode/planner.md` and a user profile at `~/.config/autoloops/profiles/strict-review/autocode/critic.md`
   - When each is activated for an `autocode` run
   - Then the matching fragment is appended to the corresponding shipped role prompt

2. **Repo Default Profiles Apply First**
   - Given `profiles.default = ["repo:phoenix", "repo:strict-ci"]` in `autoloops.toml`
   - When a run starts without `--no-default-profiles`
   - Then those defaults are active before any explicit CLI profiles and preserve config order

3. **CLI Profiles Layer On Top In CLI Order**
   - Given a run with `--profile user:test-heavy --profile user:strict-review`
   - When prompt composition occurs
   - Then matching fragments are appended after repo defaults and in the same order the CLI specified them

4. **Defaults Can Be Disabled**
   - Given repo default profiles are configured
   - When a user runs with `--no-default-profiles`
   - Then no repo default profiles are activated for that run

5. **Profiles Stay Prompt-Only**
   - Given the final implementation
   - When the code and docs are reviewed
   - Then profiles only contribute markdown prompt fragments and do not mutate topology, emits, handoff, config structure, or role identity

6. **Exact Matching Is Enforced**
   - Given a fragment at `.autoloop/profiles/phoenix/autocode/planner.md`
   - When a different preset or role is active
   - Then that fragment is not applied unless both preset and role match exactly

7. **Unknown Role Fragments Warn And Are Ignored**
   - Given an active profile contains `autocode/reviewer.md` but `autocode` has no `reviewer` role
   - When the run or inspect flow resolves the profile
   - Then the system emits a clear warning and ignores that fragment without failing the run

8. **No-Op Profiles Warn Clearly**
   - Given an activated profile contributes no matching fragments for the selected preset
   - When the run or inspect flow resolves profiles
   - Then the system emits a clear warning that the profile did not match any roles for that preset

9. **Missing Explicit Profiles Fail Fast**
   - Given a user runs with `--profile user:strict-review`
   - When `~/.config/autoloops/profiles/strict-review` does not exist
   - Then the command fails with a clear error explaining which profile was not found and where it was expected

10. **Inspect Shows Effective Prompt Composition**
    - Given a user runs `autoloops inspect prompt autocode --role critic --profile repo:phoenix --profile user:strict-review`
    - When inspect output is rendered
    - Then it shows default profiles, explicit profiles, activation order, prompt source files, warnings, and the final rendered prompt

11. **AGENTS.md Remains Authoritative In Documentation And Behavior**
    - Given the docs and implementation after the change
    - When a reader looks up how profiles interact with repo constraints
    - Then the docs clearly state that `AGENTS.md` remains authoritative repo truth and profiles only tune role behavior

12. **Implementation Stays Simple And Inspectable**
    - Given the final design
    - When reviewed against repo tenets
    - Then it uses plain directories, explicit lookup rules, and visible prompt composition rather than a registry, plugin, or inheritance system

13. **Validation Passes**
    - Given the repo after the feature is implemented
    - When the relevant test/check suite is run
    - Then the profile-related checks pass successfully

## Metadata
- **Complexity**: Medium
- **Labels**: autoloops, profiles, presets, prompts, cli, inspectability, configuration, role-tuning
- **Required Skills**: CLI design, prompt-system design, configuration design, Tonic app development, documentation, test design
