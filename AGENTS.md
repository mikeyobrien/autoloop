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

## Local CI signoff (no PR runners)

This repo does not run GitHub Actions on pull requests. After the gates
above are green and the commit is pushed, post the merge receipt:

```sh
gh extension install basecamp/gh-signoff
gh signoff
```

That writes commit status context `signoff`. Hayes/Mikey require it for merge
(`gh signoff install` or the ruleset equivalent). Exact commands and what
Actions remain: [docs/ci-local.md](docs/ci-local.md). Do not add a PR `ci.yml`
back.
