# Task: Implement Developer Toolchain Improvements

## Description
Implement 15 developer toolchain improvements across test runner ergonomics, git hooks, CI/CD, script discoverability, and TONIC_MISSING.md feedback loops. The work is organized as one umbrella task with 5 implementation slices, each self-contained with its own validation gate. Every suggestion is traceable to an S-number from the ideas report.

## Background
The developer toolchain has grown organically but lacks key connective tissue:
- `bin/test` is a 3-line wrapper that can't run a single file, has no `--help`, and its flags are undocumented
- `bin/miniloops` is a 34-line launcher with no `--help`
- `scripts/llm-judge.sh` and `scripts/pi-smoke.sh` are undocumented in `docs/cli.md`
- No git hooks are active (only `.sample` files in `.git/hooks/`)
- No CI/CD exists (no `.github/workflows/`)
- No `.tonic-version` file exists
- `TONIC_MISSING.md` has a template but zero entries, while `src/topology.tn` has an active Regex workaround

No existing task artifacts overlap with this work. Adjacent tasks that should be referenced but not superseded: none (verified scan of all `.agents/tasks/tonic-loops/*.code-task.md`).

## Reference Documentation
**Required:**
- Design: `docs/rfcs/developer-toolchain-improvements.md`
- Design: `README.md`
- Source: `bin/test`
- Source: `bin/miniloops`
- Source: `scripts/llm-judge.sh`
- Source: `scripts/pi-smoke.sh`
- Source: `src/topology.tn` (lines 2–5, 350–401 for Regex workaround)
- Docs: `docs/cli.md`
- Tracking: `TONIC_MISSING.md`

**Additional references per slice:**
- Ideas report: `.miniloop/chains/chain-mnarh86w-v9cl/step-1/.miniloop/ideas-report.md`

## Technical Requirements

### Slice 1 — Test runner ergonomics (S1–S3)
1. **S1:** Modify `bin/test` to detect when `$1` is an existing `.tn` file and use it as the test path instead of hardcoded `test/`. Fall back to current behavior when no file arg is given.
2. **S2:** Add `bin/test-watch` that uses `entr` to re-run tests on file changes. Print a clear error with install instructions if `entr` is not found. `entr` is a soft dependency.
3. **S3:** Add a "Testing" section to `docs/cli.md` documenting `--filter`, `--list`, `--format json`, `--fail-fast`, `--timeout`, `--verbose`, and the file-path shortcut.

### Slice 2 — Pre-commit / pre-push validation (S4–S6)
4. **S4:** Add `hooks/pre-commit` that runs `tonic check .` and aborts on non-zero exit.
5. **S5:** Add `bin/install-hooks` that symlinks `hooks/*` into `.git/hooks/`. Must be idempotent and handle existing symlinks. Reference in README.
6. **S6:** Add `hooks/pre-push` that runs `bin/test` and aborts on failure. Include `--no-verify` reminder in error output.

### Slice 3 — CI/CD pipeline (S7–S9)
7. **S7:** Create `.github/workflows/ci.yml` with a single job gating on `tonic check .` + `bin/test`, triggered on push to main and pull_request. Install tonic version from `.tonic-version`.
8. **S8:** Add a second CI job running `scripts/pi-smoke.sh` on pushes to main only.
9. **S9:** Add `.tonic-version` file with the current tonic version. CI reads this for installation.

### Slice 4 — Script discoverability (S10–S12)
10. **S10:** Add `bin/dev` dispatcher listing commands with no args and delegating subcommands (`test`, `watch`, `smoke`, `judge`, `run`, `hooks`).
11. **S11:** Add "Developer scripts" section to `docs/cli.md` documenting all scripts with purpose, usage, and exit codes.
12. **S12:** Add `--help`/`-h` guard to `bin/test` and `bin/miniloops` printing one-line usage and exiting.

### Slice 5 — TONIC_MISSING.md feedback loop (S13–S15)
13. **S13:** Add the Regex stdlib gap as the first entry in `TONIC_MISSING.md`. Missing capability: `Regex` module. Workaround: `grep -qE` shell-out in `src/topology.tn`. Desired: native `Regex.match?/2`.
14. **S14:** Add `bin/check-missing` script that scans `.tn` files for shell-out workaround patterns and cross-references against `# TONIC_MISSING:` annotations and `TONIC_MISSING.md` entries. Target actual patterns (`LoopUtils.shell_quote`, command composition), not a hypothetical `shell.out` function.
15. **S15:** Add `# TONIC_MISSING: Regex` annotation above the workaround in `src/topology.tn`. Document the convention in `TONIC_MISSING.md`.

### Cross-cutting
16. Update docs alongside code in each slice — do not defer docs to a follow-up.
17. Add or extend targeted tests/checks for changed behaviors.
18. Validate with `tonic check .` after all slices land.

## Dependencies
- `bin/test` (current 3-line wrapper)
- `bin/miniloops` (current 34-line launcher)
- `scripts/llm-judge.sh`, `scripts/pi-smoke.sh`
- `docs/cli.md` (current state documents miniloops but not test/scripts)
- `TONIC_MISSING.md` (template, zero entries)
- `src/topology.tn` (Regex workaround at lines 350–401)
- No external dependencies except `entr` (soft, S2 only) and GitHub Actions (S7–S8)

## Implementation Approach

### 1. Execute slice-by-slice in order
1. **Test runner ergonomics** (S1–S3) — immediate friction reduction
2. **Pre-commit / pre-push hooks** (S4–S6) — local validation tier
3. **CI/CD pipeline** (S7–S9) — remote validation tier
4. **Script discoverability** (S10–S12) — depends on new scripts from slices 1–2
5. **TONIC_MISSING.md** (S13–S15) — independent but benefits from established patterns

### 2. Keep each slice self-contained
For each slice: identify touched files, land docs updates in the same slice, add targeted tests/checks, verify before moving on.

### 3. Use plain shell scripts throughout
No external hook managers, task runners, or build tools. Consistent with the repo's zero-dependency philosophy.

### 4. Validate per-slice then repo-wide
Each slice has its own validation gate (see Acceptance Criteria). After all slices: `tonic check .`.

## Acceptance Criteria

1. **S1 file-path shortcut works**
   - `bin/test test/config_test.tn` runs only that file
   - `bin/test` without args runs the full suite unchanged

2. **S2 watch mode works or degrades gracefully**
   - `bin/test-watch` re-runs tests on file change when `entr` is available
   - `bin/test-watch` prints clear install instructions when `entr` is missing

3. **S3 test flags are documented**
   - `docs/cli.md` has a Testing section covering all 6 flags plus file-path shortcut

4. **S4 pre-commit hook gates on syntax**
   - Committing a file with broken tonic syntax is blocked
   - Clean commits proceed without delay

5. **S5 hook installer is idempotent**
   - `bin/install-hooks` creates correct symlinks from `hooks/` to `.git/hooks/`
   - Re-running `bin/install-hooks` succeeds without errors

6. **S6 pre-push hook gates on tests**
   - Pushing with failing tests is blocked with a `--no-verify` reminder
   - Pushing with passing tests proceeds normally

7. **S7 CI gates PRs**
   - `.github/workflows/ci.yml` runs `tonic check .` + `bin/test` on PRs and main pushes

8. **S8 smoke test runs on main**
   - Pi-smoke job triggers on main push only, not on PRs

9. **S9 version is pinned**
   - `.tonic-version` exists and CI reads it for tonic installation

10. **S10 dispatcher lists and delegates**
    - `bin/dev` with no args prints available commands
    - `bin/dev test`, `bin/dev smoke`, etc. delegate correctly

11. **S11 scripts are documented**
    - `docs/cli.md` has a Developer Scripts section covering all scripts

12. **S12 help flags work**
    - `bin/test --help` and `bin/miniloops --help` print usage and exit

13. **S13 Regex gap is tracked**
    - `TONIC_MISSING.md` has a complete Regex entry with all template fields

14. **S14 lint catches unannotated workarounds**
    - `bin/check-missing` warns on shell-out workaround patterns without `# TONIC_MISSING:` annotations

15. **S15 annotation is discoverable**
    - `grep -r "TONIC_MISSING:" src/` finds the Regex annotation in `src/topology.tn`

16. **Repo-level gate passes**
    - `tonic check .` succeeds after all slices land

## Metadata
- **Complexity**: Large
- **Labels**: developer-toolchain, testing, git-hooks, ci-cd, scripts, tonic-missing, documentation
- **Required Skills**: Shell scripting, GitHub Actions, CLI design, documentation, Tonic app development
