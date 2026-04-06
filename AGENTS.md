# Agent Rules

## Code Quality Gates

- All changes must have greater than 90% branch coverage and 90% line coverage.
- Never commit with `--no-verify`. Pre-commit hooks must always run.
- Run `npm run check` before committing to validate lint, types, and coverage.

## Pre-commit Hooks

The project uses Husky pre-commit hooks that enforce:
1. **Lint & format** — Biome checks staged files via lint-staged
2. **Type check** — `tsc --noEmit` ensures no type errors

Run `npm run test:coverage` before committing to verify coverage thresholds.
Run `npm run check` for the full gate (lint + types + coverage).

If a hook fails, fix the underlying issue rather than bypassing it.
