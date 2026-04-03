# Developer Toolchain Improvements

## Summary
Turn 15 validated ideas from the developer-toolchain ideas batch into one executable workstream that adds test runner ergonomics, git hooks, CI/CD gating, script discoverability, and TONIC_MISSING.md feedback loops. The output is one umbrella RFC plus one code task organized into 5 implementation slices.

Code task: `.agents/tasks/tonic-loops/developer-toolchain-improvements.code-task.md`

## Problem
The developer toolchain around tonic-loops has grown organically but lacks the connective tissue that makes a project easy to contribute to:

- **Test runner friction:** `bin/test` cannot run a single file, has no watch mode, and its flags are undocumented. Developers must know the `tonic test` flag set by reading source.
- **No validation gates:** Zero git hooks and zero CI. Broken syntax or failing tests can reach main without any automated check.
- **Script sprawl:** 4 scripts split across `bin/` and `scripts/` with no listing mechanism, no `--help`, and 3 of 4 undocumented in `docs/cli.md`.
- **Dead tracking file:** `TONIC_MISSING.md` exists with a template but zero entries, while `src/topology.tn` contains an active Regex workaround that should be the first entry.

These are individually small gaps, but together they create a contributor onboarding tax and a silent regression surface.

## Goals
- Make single-file test runs, watch mode, and flag discovery frictionless.
- Add two-tier local validation (pre-commit check, pre-push test) with one-command hook setup.
- Stand up minimal CI gating PRs and catching integration regressions on main.
- Collapse script sprawl into a single discoverable dispatcher with docs and `--help`.
- Turn TONIC_MISSING.md into a live feedback loop with an initial entry, source annotations, and enforcement.

## Non-goals
- Redesigning the build system or test framework itself.
- Adding Node/Go/Python dependencies for hook management (no husky, lefthook, etc.).
- Building a general-purpose task runner or Makefile system.
- Implementing tonic language features (e.g., native Regex) — only tracking the gap.
- Superseding existing task artifacts that cover adjacent ground.

## Proposed Design

### Slice 1 — Test runner ergonomics (S1–S3)

**S1: File-path shortcut in `bin/test`**
Detect when `$1` is an existing `.tn` file and use it as the test path instead of the hardcoded `test/` directory. Falls back to current behavior when no file arg is given.

```bash
# Current: exec tonic test test/ --fail-fast --timeout 10000 "$@"
# New: detect file arg
if [ -n "$1" ] && [ -f "$1" ]; then
  TARGET="$1"; shift
else
  TARGET="test/"
fi
exec tonic test "$TARGET" --fail-fast --timeout 10000 "$@"
```

**S2: Watch mode via `entr`**
Add `bin/test-watch` that runs `find test/ src/ -name '*.tn' | entr -c bin/test "$@"`. Print a clear error with install instructions if `entr` is not found. `entr` is a soft dependency — not required for normal development.

**S3: Document test runner flags in `docs/cli.md`**
Add a "Testing" section documenting `--filter`, `--list`, `--format json`, `--fail-fast`, `--timeout`, `--verbose`, and the file-path shortcut from S1.

### Slice 2 — Pre-commit / pre-push validation (S4–S6)

**S4: Pre-commit hook**
Add `hooks/pre-commit` (tracked in repo) that runs `tonic check .` and aborts on non-zero exit.

**S5: `bin/install-hooks` bootstrap**
Symlinks files from `hooks/` into `.git/hooks/`. Idempotent, handles existing symlinks gracefully. Referenced in README.

**S6: Pre-push hook**
Add `hooks/pre-push` that runs `bin/test` and aborts on failure. Includes a `--no-verify` reminder in the error message for emergency bypasses.

Design constraint: plain shell scripts, no external hook managers. Consistent with the repo's narrow-core, zero-dependency philosophy.

### Slice 3 — CI/CD pipeline (S7–S9)

**S7: Minimal GitHub Actions workflow**
Create `.github/workflows/ci.yml`:
- Single job triggered on `push` to main and `pull_request`
- Install tonic (version from `.tonic-version` per S9)
- Run `tonic check .` then `bin/test`

**S8: Pi-smoke integration job**
Second job triggered only on pushes to main. Runs `scripts/pi-smoke.sh`. Kept off PRs to avoid slowing the feedback loop. The script is already CI-ready (self-contained tmpdir, config, assertions, cleanup).

**S9: `.tonic-version` pinning**
Add a `.tonic-version` file (single line, e.g., `0.8.2`). CI reads it to install the matching version. Contributors can reference it locally.

### Slice 4 — Script discoverability (S10–S12)

**S10: `bin/dev` dispatcher**
Pure-shell script that prints a help listing when called with no args and dispatches subcommands:
- `bin/dev test [args]` → `bin/test`
- `bin/dev watch [args]` → `bin/test-watch`
- `bin/dev smoke` → `scripts/pi-smoke.sh`
- `bin/dev judge` → `scripts/llm-judge.sh`
- `bin/dev run [args]` → `bin/autoloops`
- `bin/dev hooks` → `bin/install-hooks`

**S11: "Developer scripts" section in `docs/cli.md`**
Document each script with purpose, usage, and exit codes. Pure documentation addition.

**S12: `--help` flag handling**
Add a 3-line guard to `bin/test` and `bin/autoloops`:
```bash
case "$1" in -h|--help) echo "Usage: ..."; exit 0;; esac
```

### Slice 5 — TONIC_MISSING.md feedback loop (S13–S15)

**S13: Backfill Regex gap**
Add the first entry to `TONIC_MISSING.md`: missing capability is `Regex` module, workaround is `grep -qE` shell-out in `src/topology.tn`, desired support is native `Regex.match?/2`.

Note: if native regex support lands via the `regex-event-matching` task, this entry should be updated to reflect partial resolution. The entry still has value as the canonical example of the tracking convention.

**S14: Lint script for `shell.out` without TONIC_MISSING entry**
Add `bin/check-missing` that scans `.tn` files for shell-out workarounds and cross-references `# TONIC_MISSING:` annotations against `TONIC_MISSING.md` entries. Start as a grep-based script.

Note: research found no literal `shell.out` calls in `src/`. The topology workaround uses `LoopUtils.shell_quote` + command composition. S14's lint should target the actual shell-out patterns found in the codebase, not a hypothetical `shell.out` function name.

**S15: Source annotation convention**
Adopt `# TONIC_MISSING: <capability>` placed above workaround sites. Makes workarounds discoverable via `grep -r "TONIC_MISSING:"`. Apply immediately to the Regex workaround in `src/topology.tn`.

## Execution Shape
One umbrella task executed slice-by-slice. Each slice is self-contained with its own validation gate. Recommended order:

1. **Test runner ergonomics** — immediate developer friction reduction
2. **Pre-commit / pre-push hooks** — local validation tier
3. **CI/CD pipeline** — remote validation tier (depends on S9 for version pinning)
4. **Script discoverability** — depends on S1/S2 for new scripts to document
5. **TONIC_MISSING.md** — independent but benefits from the established contribution patterns

Slices 1–2 and 5 are independent and could execute in parallel. Slices 3–4 have light dependencies on earlier slices.

## Validation Strategy

Per-slice validation:
- **Slice 1:** `bin/test test/config_test.tn` runs a single file successfully; `bin/test` without args still runs the full suite; `bin/test-watch` errors gracefully when `entr` is missing
- **Slice 2:** `bin/install-hooks` creates symlinks; committing broken syntax is blocked; pushing failing tests is blocked; re-running `bin/install-hooks` is idempotent
- **Slice 3:** CI workflow passes on a clean branch; pi-smoke job runs on main push only; `.tonic-version` is read by CI
- **Slice 4:** `bin/dev` lists all commands; `bin/dev test` delegates correctly; `bin/test --help` and `bin/autoloops --help` print usage
- **Slice 5:** `TONIC_MISSING.md` has the Regex entry; `bin/check-missing` warns on unannotated workarounds; `grep -r "TONIC_MISSING:" src/` finds the annotation

Repo-level gate: `tonic check .` passes after all slices land.

## Risks And Boundaries
- **CI tonic installation:** S7 assumes tonic can be installed in CI via `cargo install` or a binary release. If neither path works cleanly, CI work may need to block on a tonic distribution decision.
- **`entr` availability:** S2 treats `entr` as a soft dependency. The watch script must degrade gracefully and not become a blocker for basic test workflows.
- **Shell-out pattern discovery (S14):** The lint rule must target actual shell-out patterns (`LoopUtils.shell_quote`, command composition) rather than a literal `shell.out` function that doesn't exist in this codebase.
- **Overlap with regex-event-matching task:** S13's Regex gap entry may become partially obsolete if native regex lands. The entry should be updatable, not treated as permanent.
- **Hook bypass culture:** Hooks are advisory — `--no-verify` always works. The value is in the default path, not enforcement.

## Open Questions
No design blockers remain. The remaining work is implementation planning and execution.
