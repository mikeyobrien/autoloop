# Context: Implement Remaining Auto Workflow Presets

## Request summary
Implement the 6 future-facing presets documented in `docs/auto-workflows.md`: autotest, autofix, autoreview, autodoc, autosec, autoperf.

## Source type
Taxonomy document at `docs/auto-workflows.md`

## Existing presets (reference for structure)
| Preset | Shape | Required event | Shared state |
|--------|-------|----------------|--------------|
| `autocode` | planner → builder → critic → finalizer | `review.passed` | context.md, plan.md, progress.md |
| `autoideas` | scanner → analyst → reviewer → synthesizer | `analysis.validated` | scan-areas.md, progress.md, ideas-report.md |
| `autoresearch` | strategist → implementer → benchmarker → evaluator | `experiment.measured` | autoresearch.md, experiments.jsonl, progress.md |
| `autoqa` | inspector → planner → executor → reporter | `qa.passed` | qa-plan.md, qa-report.md, progress.md |

## Preset structure (every preset has)
- `miniloops.toml` — loop config (Pi backend, 100 iterations, completion/required events)
- `topology.toml` — name, roles with emits + prompt_file, handoff map
- `harness.md` — global rules loaded every iteration
- `roles/*.md` — one file per role
- `README.md` — usage and explanation

## Constraints
- Follow existing patterns exactly (Pi backend, same config shape)
- Each preset gets its own behavioral center — do not clone autocode topology
- Handoff graphs must have no dead ends and all events routed
- No core engine changes
- Validate with `tonic check .` after each preset
