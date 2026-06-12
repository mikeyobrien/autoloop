# Agent-ergonomics audit — pass 1 handoff

**Date:** 2026-06-11 · **Mode:** full · **Branch:** main (no new branch) ·
**Workspace:** in-tree at `agent_ergonomics_audit/`

## What shipped (13 substantive changes)

See `ambition_bar_check.md` for the full list and `scorecard.md` for per-surface
deltas. Headline: the CLI now has a real error contract (stderr + exit-code
dictionary), did-you-mean on every command/subcommand/flag typo path,
`--version`, `help`, `capabilities`, `robot-docs`, and a `triage` mega-command.
`config unset` was advertised-but-missing and is now implemented.

## Deferred for pass 2 (ranked)

1. **EXIT_ENV (2) is defined but barely used.** doctor/env failures still exit 1.
   Migrate environment/state errors to exit 2 per the published dictionary.
2. **`--json` on remaining read surfaces:** `worktree list/show/diff` (diff has it),
   `memory list/status`, `task list`, `runs clean --dry-run`.
3. **`runs clean` / `worktree clean` have no `--dry-run`.** Safety dimension:
   add plan/preview mode (clean is run-scoped state only, so blast radius is low).
4. **NO_COLOR/non-TTY audit for dashboard/kanban/watch** (main CLI output is
   already plain; the live-watch path uses ANSI — verify isatty discipline).
5. **`emit` usage exits 0 on missing topic** — convert to failMissingArg.
6. **Schema-pin test for `capabilities`** beyond determinism (snapshot the full
   document so contract drift fails CI).
7. **control/guide error paths** still print some errors via console.log.

## How to re-open

- Re-score: probe battery in `agent_simulations/post_pass_1/intent_corpus_results.md`.
- Regression suite: `npx vitest run test/integration/agent-surfaces-cli.test.ts`.
- The full gate: `npm run check` (lint + types + 1401 tests + coverage).
