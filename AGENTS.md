# AGENTS.md

## Repo Tenets

### 1. Keep the framework as simple as possible
Prefer the smallest mechanism that works.
Avoid adding new runtime layers, plugin systems, abstractions, or protocol machinery unless they clearly remove more complexity than they introduce.

### 2. Let LLMs do the heavy lifting
Push intelligence into prompts, roles, working files, and loop structure before adding engine features.
Prefer agent judgment over hardcoded workflow logic when the behavior can be expressed clearly and inspected safely.

### 3. Context is first-class
Context is part of the product, not incidental scaffolding.
Design loops so the right context is easy to load, trim, archive, inspect, and revise.

### 4. Memory is first-class
Durable memory should be explicit, inspectable, and reusable across iterations.
Use memory intentionally for short durable lessons, preferences, and meta observations.

### 5. Durable state should live in git-friendly formats
Prefer plain, durable, inspectable formats such as:
- `jsonl` for append-only runtime/event history
- `md` for curated plans, context, archived notes, and reports
- small text config files such as `toml`

Avoid opaque state stores when a human-readable file will do.

### 6. Journal-first for runtime truth
Machine-owned runtime facts should prefer append-only journal state over ad hoc prose.
If state can be derived from structured events, prefer deriving it rather than duplicating it manually.
Coordination events (`issue.*`, `slice.*`, `context.archived`) make issue/slice/commit lifecycle reconstructable from the journal.
Use `inspect coordination --format md` to project current state from journal events.

### 7. Markdown for curated intent
Keep `.miniloop/context.md`, `.miniloop/plan.md`, `.miniloop/progress.md`, and `docs/*.md` as human-shaped artifacts.
These files should stay concise, editable, and useful to both humans and agents.
`.miniloop/progress.md` is a lightweight human-facing summary; the journal is canonical for machine-owned coordination state.

### 8. Archive, don’t accumulate
When context stops helping the active objective, consolidate and archive it into `docs/` instead of letting active working files grow indefinitely.

### 9. Prefer explicit files over hidden behavior
If a workflow matters, make it visible in:
- prompts
- topology
- working files
- journal events
- docs

Avoid magic.

### 10. Optimize for inspectability
A good loop should be easy to understand from files on disk:
- what happened
- what changed
- what remains
- why the loop made its decisions

### 11. Preserve narrow core, rich presets
Keep the engine small and opinionated.
Let examples, presets, prompts, and role decks carry most of the specialization.

### 12. Make ownership explicit
Relevant issues should never be hand-waved away as “pre-existing.”
If something matters to the objective, touched surface, or verification path, it must be fixed, owned, deferred explicitly, or proven out of scope.

### 13. Prefer clean breaks over compatibility shims
This is alpha software. Breaking changes are expected.
Do not add fallback paths, deprecation shims, compatibility aliases, dual-write migrations, or legacy codepaths unless explicitly requested.
When a design changes, update the canonical path and remove the old one.

### 14. Record stdlib gaps when using workarounds
If something is missing from the Tonic stdlib, a local workaround is acceptable when needed to keep moving.
But every such workaround must be recorded in `TONIC_MISSING.md` so the gap remains visible and can be fixed at the source later.
