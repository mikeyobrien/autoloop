# Context: `check .`

## Objective
Run the repo's project check from the repository root and get it passing.

## Interpreted command
- `tonic check .` from `/Users/rook/projects/tonic-loops`
- Source: `README.md` documents `tonic check .` as the repo check surface.

## Source type
- Bare-minimal miniloops harness request
- No `.code-task.md` input

## Constraints
- Planner only: do not implement or review in this turn.
- Keep one concrete slice active.
- Prefer the smallest fix that makes `tonic check .` pass.
- If `tonic check .` fails, fix the first real blocker on the touched surface before widening scope.
- Verification for completion must include a fresh successful `tonic check .`.

## Acceptance criteria
1. `tonic check .` succeeds from the repo root.
2. Any code change is narrowly scoped to the failure blocking that check.
3. Shared working files stay aligned with this objective.
