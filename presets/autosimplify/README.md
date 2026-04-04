# AutoSimplify miniloop

An autoloop-native post-implementation cleanup loop inspired by Claude Code's `/simplify` workflow.

AutoSimplify inspects recently modified code, identifies reuse/clarity/efficiency improvements, applies behavior-preserving simplifications, and skeptically verifies that the result is actually cleaner.

Shape:
- scoper — identifies the simplification scope and batches it
- reviewer — finds concrete simplification opportunities in the current batch
- simplifier — applies the cleanup and runs checks
- verifier — independently confirms behavior was preserved and the code is simpler

## Fail-closed contract

AutoSimplify is not a refactor free-for-all.

- Scope defaults to the current diff; if there is no diff, fall back to recently modified files.
- Behavior preservation is mandatory.
- Drive-by rewrites outside the scoped files are rejected.
- Missing validation evidence means reject or retry, not completion.
- "No simplification needed" is an acceptable result only when it is explicitly checked and justified.

## How it works

1. **Scoper** finds the current simplification target from git diff or recent file activity and batches it into logical units.
2. **Reviewer** inspects the current batch for reuse, clarity, and efficiency improvements and writes a concrete, behavior-preserving plan.
3. **Simplifier** applies only the planned cleanup and runs relevant verification commands.
4. **Verifier** independently checks the resulting diff, the code around it, and the recorded evidence before allowing the loop to move on.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared harness rules loaded every iteration
- `roles/scoper.md`
- `roles/reviewer.md`
- `roles/simplifier.md`
- `roles/verifier.md`

## Shared working files created by the loop

- `.autoloop/simplify-context.md` — scope, batching, affected files, and guardrails
- `.autoloop/simplify-plan.md` — current batch findings and concrete cleanup plan
- `.autoloop/progress.md` — batch status, changes made, verification results, and next action

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
autoloop run presets/autosimplify "Simplify the current diff"
```

For a one-off Claude dogfood run without editing config:

```bash
autoloop -b claude presets/autosimplify "Simplify the current diff"
```

## Intended input styles

The preset is optimized for post-implementation cleanup:
- simplify the current git diff
- simplify recently modified files when there is no staged/unstaged diff
- simplify an explicitly named file or directory from the user prompt

The scoper must normalize that into concrete batches and keep the loop focused on one batch at a time.
