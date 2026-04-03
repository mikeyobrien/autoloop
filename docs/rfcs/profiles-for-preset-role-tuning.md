# Profiles for Preset Role Tuning

## Summary
Add a first-class **profiles** mechanism for tuning shipped preset roles without forking presets. A profile is an append-only set of role-specific markdown prompt fragments. Profiles can live in **repo scope** for team-shared behavior or **user scope** for personal runtime modes. Repos may also declare default active profiles.

This keeps preset structure stable while giving users a clean way to adapt role behavior to a repo, stack, or working style.

Code task: `.agents/tasks/tonic-loops/profiles-for-preset-role-tuning.code-task.md`

## Problem
Today, users who want to adapt a preset to a repo have awkward options:

- fork a whole preset just to add a few instructions
- stuff repo-specific behavior into generic role prompts
- rely on ad hoc prompt text at runtime
- blur repo-wide constraints and role-specific tuning

That makes customization heavier than it should be and encourages copying workflow bundles that should remain canonical.

The missing abstraction is:

> keep the preset, but layer extra role guidance onto it in an inspectable way.

## Goals
- Let users tune preset role behavior without copying presets
- Support both repo-shared and user-personal tuning
- Support repo default profiles
- Keep the mechanism markdown-first and inspectable
- Preserve preset topology, role identity, and event contracts
- Make prompt composition visible and debuggable

## Non-goals
Profiles do not:

- replace presets
- inherit from presets
- patch `topology.toml`
- patch `autoloops.toml` beyond declaring repo default profile names
- add or remove roles
- change `emits`
- change handoff routing
- act as a generalized overlay or merge system
- support arbitrary path-based activation in v1

## Proposed Design

### Core model
A profile is a directory of optional markdown fragments keyed by preset and role.

If the active preset is `autocode` and the active role is `critic`, autoloops appends any matching active profile fragments to the shipped `autocode` critic prompt.

Profiles are intentionally **prompt-only** and **append-only**.

### Scopes
Support two profile scopes in v1.

#### Repo profiles
Checked into the repo:

```text
.autoloop/profiles/<profile>/<preset>/<role>.md
```

Use for team-shared tuning tied to this codebase.

#### User profiles
Stored outside the repo:

```text
~/.config/autoloops/profiles/<profile>/<preset>/<role>.md
```

Use for personal reusable modes like strict-review or test-heavy behavior.

### Activation syntax
Profiles are selected explicitly by scope and name:

```bash
autoloops run autocode "..." --profile repo:phoenix
autoloops run autocode "..." --profile user:strict-review
```

Only these forms are supported in v1:
- `repo:<name>`
- `user:<name>`

Bare names are intentionally not supported in v1 because they create avoidable repo/user collision ambiguity.

### Repo default profiles
Repos may declare default active profiles in `autoloops.toml`:

```toml
profiles.default = ["repo:phoenix"]
```

Users may suppress defaults:

```bash
autoloops run autocode "..." --no-default-profiles
```

### Activation order
Profile layering order is:

1. repo default profiles from config, in listed order
2. explicit CLI profiles, in provided order

This makes user-selected runtime tuning naturally layer on top of repo defaults.

### Prompt composition
For a given role, the effective prompt is built as:

1. shipped preset role prompt
2. active profile fragments in activation order

Example for `autocode/critic`:

1. `presets/autocode/roles/critic.md`
2. `.autoloop/profiles/phoenix/autocode/critic.md`
3. `~/.config/autoloops/profiles/strict-review/autocode/critic.md`

The semantics are deliberately simple: **ordered text append**. No structural merge logic.

### Matching rules
Matching is exact in v1:
- exact profile
- exact preset
- exact role

No wildcards.

### Validation behavior
- If an explicitly requested profile directory does not exist: fail fast with a clear error.
- If an active profile contains a fragment for a role not present in the preset: warn and ignore it.
- If an activated profile contributes nothing for the selected preset: warn clearly.

This keeps v1 forgiving about drift without hiding mistakes.

### Inspectability
Profiles only stay elegant if prompt composition is visible.

Extend prompt inspection to show:
- repo default profiles
- explicit CLI profiles
- final activation order
- prompt source files in order
- warnings
- final rendered prompt

Example shape:

```bash
autoloops inspect prompt autocode --role critic --profile user:strict-review
```

## AGENTS.md Interaction
`AGENTS.md` remains authoritative repo truth.

Profiles are for **preset-role-specific tuning**, not for overriding repo-wide constraints. The docs should state this plainly.

A good split is:
- `AGENTS.md`: repo-wide behavior, constraints, commands, boundaries
- profiles: role-specific tuning for a preset in this repo or user mode

## UX and File Layout

### Repo profile example
```text
.autoloop/profiles/phoenix/autocode/planner.md
```

```md
Repo-specific planner guidance:
- Prefer slices that stay within a single Phoenix context when possible.
- If a change crosses controller, context, and schema layers, split planning so verification stays crisp.
- Always call out migration impact explicitly in the slice.
```

### User profile example
```text
~/.config/autoloops/profiles/strict-review/autocode/critic.md
```

```md
Strict review mode:
- Do not accept “looks correct” as evidence.
- Require exact verification commands and observed results before approval.
- Treat snapshot-only updates as weak evidence unless behavior change is explained.
```

### Example run
```bash
autoloops run autocode "Add OAuth login" \
  --profile user:strict-review
```

If the repo has:

```toml
profiles.default = ["repo:phoenix"]
```

then the active profile order is:
1. `repo:phoenix`
2. `user:strict-review`

## Alternatives Considered

### Repo-only role extensions
This solves shared repo tuning but does not support runtime-swappable personal modes.

Rejected because the feature should support both team defaults and personal overlays with one abstraction.

### General overlays
“Overlay” sounds attractive, but it implies broader mutation power: config merges, topology patching, replacement semantics, or structural overrides.

Rejected because the feature should stay narrowly prompt-level and inspectable.

### Preset inheritance / `extends`
This would let users derive custom presets from built-ins.

Rejected because it creates merge semantics for topology, config, role definitions, and precedence. That is a much larger and murkier feature than needed.

### Arbitrary path-based profiles in v1
Useful eventually, but they complicate CLI grammar, naming, and inspect output.

Deferred to keep the first version simple and explicit.

## Open Questions
These are implementation details, not design blockers:
- whether warnings should surface only in inspect/debug output or also during normal runs
- whether prompt source provenance should also be recorded into the journal
- whether a later v2 should support harness-level profile fragments

## Implementation Notes
Likely touched areas:
- `src/config.tn` for `profiles.default`
- `src/main.tn` for `--profile` and `--no-default-profiles`
- `src/topology.tn` or adjacent prompt-loading logic for layered role prompt assembly
- `src/harness.tn` for prompt/debug rendering and provenance
- docs for config, inspect, and profile behavior
- tests for ordering, validation, and inspect output

Execution artifact:
- `.agents/tasks/tonic-loops/profiles-for-preset-role-tuning.code-task.md`
