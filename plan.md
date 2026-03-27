# Plan: Implement Remaining Auto Workflow Presets

## Slice 1 — `autotest` preset

Formal test creation and test-suite tightening.

**Shape:** surveyor → writer → runner → assessor
- surveyor: analyze codebase, find coverage gaps, identify untested paths
- writer: write test code for the identified gap
- runner: execute the new tests, capture results
- assessor: evaluate test quality, coverage delta, decide continue/complete

**Required event:** `tests.passed`
**Shared state:** `test-plan.md`, `test-report.md`, `progress.md`
**Files:** `examples/autotest/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 2 — `autofix` preset

Bug diagnosis and repair from a bug report or failing test.

**Shape:** diagnoser → fixer → verifier → closer
- diagnoser: reproduce the bug, trace root cause, narrow scope
- fixer: implement the minimal fix
- verifier: verify the fix (run failing test, check regression)
- closer: confirm fix is correct, decide if more fixes needed

**Required event:** `fix.verified`
**Shared state:** `bug-report.md`, `fix-log.md`, `progress.md`
**Files:** `examples/autofix/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 3 — `autoreview` preset

Code review loop for PR diffs or change sets.

**Shape:** reader → checker → suggester → summarizer
- reader: read the diff/changes, build context
- checker: check for correctness, security, style, performance issues
- suggester: propose concrete fixes for found issues
- summarizer: compile review into structured feedback

**Required event:** `review.checked`
**Shared state:** `review-context.md`, `review-findings.md`, `progress.md`
**Files:** `examples/autoreview/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 4 — `autodoc` preset

Documentation generation and maintenance.

**Shape:** auditor → writer → checker → publisher
- auditor: compare docs to code, find gaps and staleness
- writer: write or update documentation for the identified gap
- checker: verify doc accuracy against actual code
- publisher: compile doc-report, decide continue/complete

**Required event:** `doc.checked`
**Shared state:** `doc-plan.md`, `doc-report.md`, `progress.md`
**Files:** `examples/autodoc/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 5 — `autosec` preset

Security audit and hardening.

**Shape:** scanner → analyst → hardener → reporter
- scanner: scan for vulnerabilities (OWASP top-10, deps, secrets, config)
- analyst: deep-dive each finding, classify severity, confirm/dismiss
- hardener: implement the fix or mitigation
- reporter: compile security report, track findings

**Required event:** `finding.confirmed`
**Shared state:** `sec-findings.md`, `sec-report.md`, `progress.md`
**Files:** `examples/autosec/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 6 — `autoperf` preset

Performance profiling and optimization.

**Shape:** profiler → optimizer → measurer → judge
- profiler: identify hot paths, establish baselines
- optimizer: implement targeted optimization
- measurer: run benchmarks, capture before/after metrics
- judge: evaluate improvement, keep/discard, decide next target

**Required event:** `perf.measured`
**Shared state:** `perf-profile.md`, `perf-log.jsonl`, `progress.md`
**Files:** `examples/autoperf/` (miniloops.toml, topology.toml, harness.md, 4 roles, README.md)

## Slice 7 — Update docs and validate

- Update `docs/auto-workflows.md` to mark all 10 presets as implemented
- Update README.md workflow family table to include all 10
- Run `tonic check .`

## Out of scope
- Core engine changes
- LLM-as-judge additions beyond what autoresearch already provides
- CWD/preset separation
