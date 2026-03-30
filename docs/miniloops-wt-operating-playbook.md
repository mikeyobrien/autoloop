# Autoloops + wt Operating Playbook

This playbook is the practical operator guide for running Autoloops inside Git worktrees managed by `wt` (Worktrunk).

It is written for the real local setup verified on this machine:
- `wt` 0.33.0 at `/opt/homebrew/bin/wt`
- `autoloops` via `./bin/autoloops` inside `/Users/rook/projects/tonic-loops`
- Pi-backed smoke test verified with `./scripts/pi-smoke.sh`

## Mental model

Use `wt` to create and move between isolated task branches.

Use Autoloops inside the selected worktree to run the right `auto*` preset for the task:
- `autocode` for implementation
- `autoqa` for validation
- `autoreview` for review
- `autospec` for turning rough ideas into durable specs/tasks
- `autofix` for bug repair
- `autotest` for writing tests
- `autosimplify` for cleanup
- `autodoc` for docs work
- `autoideas`, `autoresearch`, `autosec`, `autoperf` for their respective domains

Recommended rhythm:
1. Create or switch to a task worktree with `wt`
2. Enter that worktree explicitly if shell integration is not active
3. Run the appropriate Autoloops preset in that worktree
4. Inspect outputs/artifacts
5. Merge with `wt merge`
6. Only run `wt remove` if you merged with `--no-remove` or are cleaning up without merging

## Core commands

### wt

List worktrees:

```bash
wt list
```

Create a new branch + worktree:

```bash
wt switch --create feature-name
```

Switch to an existing worktree:

```bash
wt switch feature-name
```

Merge current branch into the default branch:

```bash
wt merge
```

Remove the current worktree:

```bash
wt remove
```

### Autoloops

Documented wrapper form:

```bash
./bin/autoloops run <preset|.> [prompt...]
```

Direct Tonic equivalent:

```bash
tonic run /Users/rook/projects/tonic-loops run <preset|.> [prompt...]
```

Example invocations:

```bash
./bin/autoloops run autocode "Implement the requested feature"
./bin/autoloops run autoqa "Validate the current changes"
./bin/autoloops run autoreview "Review the current diff"
./bin/autoloops run . "Operate on this local autoloops project"
```

Inspect outputs:

```bash
./bin/autoloops inspect scratchpad --format md
./bin/autoloops inspect memory --format md
./bin/autoloops inspect coordination --format md
./bin/autoloops inspect metrics --format md
./bin/autoloops inspect output 1 --format text
```

Run a chain:

```bash
./bin/autoloops run . --chain autocode,autoqa
./bin/autoloops chain list .
./bin/autoloops inspect chain --format md
```

## Recommended operating flows

## 1) New implementation task

From the repo root:

```bash
wt switch --create feature-login-fix
```

If shell integration is active, `wt switch` can move you there automatically. Otherwise `cd` into the created worktree path and then run:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autocode "Fix the login flow and leave the repo passing"
```

Inspect the run:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops inspect metrics --format md
/Users/rook/projects/tonic-loops/bin/autoloops inspect scratchpad --format md
```

Validate with a second loop if needed:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autoqa "Validate the current changes and report any failures"
```

Merge when ready:

```bash
wt merge --no-remove
wt remove
```

## 2) Review-only pass on a worktree

Switch to the worktree:

```bash
wt switch feature-review-target
```

If shell integration is not active, `cd` into the selected worktree path before running review:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autoreview "Review the current diff for correctness, risk, and missing tests"
```

Inspect:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops inspect scratchpad --format md
/Users/rook/projects/tonic-loops/bin/autoloops inspect coordination --format md
```

## 3) Spec-first flow

Create a task worktree:

```bash
wt switch --create feature-new-flow
```

If shell integration is not active, `cd` into the created worktree path first. Then draft the plan/spec:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autospec "Turn this rough idea into an RFC and implementation task"
```

Then implement:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autocode "Implement the approved spec from this worktree"
```

## 4) Chain flow for implementation + QA

If the current directory is itself a valid Autoloops project:

```bash
./bin/autoloops run . --chain autocode,autoqa
```

Otherwise run the presets sequentially from the tonic-loops repo binary:

```bash
/Users/rook/projects/tonic-loops/bin/autoloops run autocode "Implement the requested change"
/Users/rook/projects/tonic-loops/bin/autoloops run autoqa "Validate the requested change"
```

## Non-interactive / agent-safe mode

For automation, agents, scripts, or shells without active `wt` shell integration, prefer explicit non-interactive flags.

Create/select a worktree without relying on shell directory changes:

```bash
wt switch --create feature-name --no-cd -y
```

Merge without prompts:

```bash
wt merge -y
```

Remove deterministically and wait for cleanup to finish:

```bash
wt remove -y --foreground
```

Why:
- `--no-cd` avoids depending on shell wrapper behavior
- `-y` skips approval prompts
- `--foreground` keeps cleanup blocking and predictable

## Shell integration notes for wt

`wt` can only change the parent shell directory when its shell integration wrapper is active.

Install it with:

```bash
wt config shell install
```

Then restart the shell and verify:

```bash
type wt
```

Without active shell integration:
- `wt switch` still creates/selects worktrees
- but it cannot actually `cd` the parent shell
- in that case use `--no-cd` and change directories yourself

## Autoloops operator notes

### Canonical invocation

Prefer the explicit documented form:

```bash
./bin/autoloops run autocode "Your task"
```

Use the documented `run` form in scripts, docs, and operator workflows. It is the clearest and least ambiguous invocation shape.

### Required preset argument

`run` requires a preset-name or preset-directory style argument:
- bundled preset name such as `autocode`, `autoqa`, `autoreview`
- explicit preset directory
- `.` when the current directory itself is a valid Autoloops project

### Help

Subcommand help works as expected:

```bash
./bin/autoloops run --help
```

Use:

```bash
./bin/autoloops --help
```

for top-level help.

### Smoke test

Use the built-in smoke script to verify the Pi-backed path:

```bash
./scripts/pi-smoke.sh
```

This was verified to pass locally.

## wt operator notes

### Merge semantics

`wt merge` means:
- merge the current branch into the target branch
- default target is the repository default branch

This is intentionally different from how people often reason about plain `git merge`.

### Defaults

`wt merge` is opinionated by default:
- squash enabled
- rebase enabled
- remove worktree enabled
- verify hooks enabled

Useful overrides:

```bash
wt merge --no-squash    # keep original commits
wt merge --no-remove    # keep worktree after merge
wt merge --no-rebase    # do not rebase before merge
wt merge --no-commit    # skip commit/squash preparation; requires a clean tree
```

### Remove semantics

`wt remove` and force flags are easy to confuse:

```bash
wt remove --force         # remove worktree even with untracked files
wt remove -D              # delete branch even if unmerged
wt remove --no-delete-branch
```

Use `--foreground` for deterministic scripted cleanup.

## Suggested preset chooser

Use this quick map when deciding what to run:

| Goal | Preset |
|---|---|
| Implement a feature or change | `autocode` |
| Validate the repo or changed code | `autoqa` |
| Review a diff / PR / change set | `autoreview` |
| Turn a rough idea into a plan/spec | `autospec` |
| Fix a bug | `autofix` |
| Add or improve tests | `autotest` |
| Simplify or clean up recent changes | `autosimplify` |
| Write or repair docs | `autodoc` |
| Survey improvement opportunities | `autoideas` |
| Run an experiment loop | `autoresearch` |
| Security review | `autosec` |
| Performance optimization | `autoperf` |

## A pragmatic default workflow

For most code tasks:

```bash
wt switch --create feature-short-name
# cd into the worktree if shell integration is not active
/Users/rook/projects/tonic-loops/bin/autoloops run autocode "Implement the requested change"
/Users/rook/projects/tonic-loops/bin/autoloops run autoqa "Validate the current changes"
wt merge --no-remove
wt remove
```

For review tasks:

```bash
wt switch feature-short-name
# cd into the worktree if shell integration is not active
/Users/rook/projects/tonic-loops/bin/autoloops run autoreview "Review the current diff"
```

## Troubleshooting

### `wt switch` created a worktree but did not change directories
- Shell integration is not active in the current shell
- Fix: run `wt config shell install`, restart shell, verify with `type wt`
- Or use `wt switch ... --no-cd` and `cd` manually

### `./bin/autoloops run --help` did not show help
- This should now print `run` subcommand usage
- If it does not, you are likely on an older checkout or binary; rerun from the current repo/build

### `autoloops run .` failed
- `.` only works if the current directory contains a valid Autoloops config/project
- Use a named preset (`autocode`, `autoqa`, etc.) or point at an explicit preset directory instead

### I want a predictable agent-safe flow
Use:

```bash
wt switch --create feature-name --no-cd -y
# cd into the created worktree path
/Users/rook/projects/tonic-loops/bin/autoloops run autocode "Your task"
wt merge --no-remove -y
wt remove -y --foreground
```

## Verification notes

The following were verified locally while writing this playbook:
- `./scripts/pi-smoke.sh` passed
- `./bin/autoloops --help` works
- `./bin/autoloops run --help` works
- documented Autoloops `run` invocation works
- `wt --help`, `wt switch --help`, `wt merge --help`, `wt remove --help`, and `wt config show` work
- a temporary git repo successfully exercised:
  - `wt switch --create ... --no-cd -y`
  - `wt list`
  - `wt merge --no-squash --no-remove -y`
  - `wt remove -y --foreground`
