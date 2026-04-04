# AutoSpec miniloop

An autoloop-native specification loop for turning a rough idea into a durable RFC + implementation task pair.

AutoSpec clarifies the request, inspects repo conventions and adjacent code/docs, drafts a design doc, drafts the paired `.code-task.md`, and adversarially checks that the pair is aligned and actionable.

Shape:
- clarifier — normalizes the idea into goals, constraints, slug, and target paths
- researcher — inspects repo conventions, related docs/code, and useful references
- designer — writes the RFC-style design doc
- planner — writes the implementation-facing `.code-task.md`
- critic — attacks vagueness, weak acceptance criteria, and misalignment

## Fail-closed contract

AutoSpec is not done when the docs merely sound plausible.

- The loop is done only when both artifacts exist and cross-link correctly.
- Unresolved ambiguity must be explicit, not silently hand-waved.
- Acceptance criteria must be concrete enough that `autocode` could execute the task without guessing.
- Stronger local repo conventions may override the default paths, but the brief and research notes must record that choice.

## How it works

1. **Clarifier** writes `.autoloop/spec-brief.md` with goals, non-goals, constraints, assumptions, slug, and output paths.
2. **Researcher** writes `.autoloop/spec-research.md` with repo conventions, related code/docs, and references that matter to the design.
3. **Designer** drafts the RFC-style design doc.
4. **Planner** drafts the paired `.code-task.md`.
5. **Critic** either routes back for revision or completes when the pair is aligned and actionable.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/clarifier.md`
- `roles/researcher.md`
- `roles/designer.md`
- `roles/planner.md`
- `roles/critic.md`

## Shared working files created by the loop

- `.autoloop/spec-brief.md` — clarified objective, title/slug, constraints, assumptions, output paths
- `.autoloop/spec-research.md` — repo conventions, related docs/code, references, open gaps
- `.autoloop/progress.md` — current phase, active artifact paths, critic checklist, revision log

## Default artifact outputs

- `docs/rfcs/<slug>.md`
- `.agents/tasks/<project-name>/<slug>.code-task.md`

If the repo already has a clearly stronger planning convention, AutoSpec should follow that instead and record the decision in `.autoloop/spec-brief.md`.

## Backend

This preset assumes the built-in Pi adapter:

```toml
backend.kind = "pi"
backend.command = "pi"
```

For deterministic local harness debugging only, switch to the repo mock backend:

```toml
backend.kind = "command"
backend.command = "../../examples/mock-backend.sh"
```

## Run

From the repo root:

```bash
autoloop run autospec "Add preset-level profiles for role tuning"
```

## Intended input styles

AutoSpec works best with:
- a rough feature or workflow idea
- a local note or markdown file path
- an existing draft spec/RFC that needs to be normalized into the repo's durable planning artifacts
