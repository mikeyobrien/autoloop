# Auto Workflow Family

Miniloops ships a family of `auto*` preset workflows. Each one is a self-contained agentic loop with a distinct behavioral center, topology, and shared-state contract. This document is the canonical taxonomy.

## Implemented presets

### autocode

Code implementation loop. Takes a task description (prose, `.code-task.md` path, or existing implementation directory), breaks it into slices, builds each slice, reviews, and gates completion.

**Shape:** planner → builder → critic → finalizer
**Shared state:** `context.md`, `plan.md`, `progress.md`, `logs/`
**Example:** `examples/autocode/`

### autoideas

Repository survey and improvement report. Scans a target repo for areas worth improving, deep-dives each area, validates suggestion quality, and compiles an actionable report.

**Shape:** scanner → analyst → reviewer → synthesizer
**Shared state:** `scan-areas.md`, `progress.md`, `ideas-report.md`
**Example:** `examples/autoideas/`

### autoresearch

Autonomous experiment loop. Hypothesize, implement, measure, keep or discard. Supports LLM-as-judge for semantic evaluation when hard metrics are insufficient.

**Shape:** strategist → implementer → benchmarker → evaluator
**Shared state:** `autoresearch.md`, `experiments.jsonl`, `progress.md`
**Example:** `examples/autoresearch/`

### autoqa

Native, zero-dependency validation orchestration. Inspects the target repo, infers its domain, selects the idiomatic validation surface, writes a validation plan, and executes it — all without installing external test frameworks.

**Shape:** inspector → planner → executor → reporter
**Shared state:** `qa-plan.md`, `qa-report.md`, `progress.md`
**Example:** `examples/autoqa/`

### autotest

Formal test creation and test-suite tightening. Surveys the codebase for coverage gaps, writes new tests using the repo's existing framework and conventions, runs them, and assesses quality improvement.

**Shape:** surveyor → writer → runner → assessor
**Shared state:** `test-plan.md`, `test-report.md`, `progress.md`
**Example:** `examples/autotest/`

### autofix

Bug diagnosis and repair. Narrower than autocode — starts from a bug report or failing test rather than a feature request. Reproduces the issue, traces the root cause, implements a minimal fix, and verifies with regression checks.

**Shape:** diagnoser → fixer → verifier → closer
**Shared state:** `bug-report.md`, `fix-log.md`, `progress.md`
**Example:** `examples/autofix/`

### autoreview

Code review loop. Reads a PR diff or set of changes, checks for correctness, security, style, performance, and maintainability issues, proposes concrete fixes, and produces structured review feedback with a clear verdict.

**Shape:** reader → checker → suggester → summarizer
**Shared state:** `review-context.md`, `review-findings.md`, `progress.md`
**Example:** `examples/autoreview/`

### autodoc

Documentation generation and maintenance. Audits existing docs against the codebase, identifies gaps and staleness, writes or updates documentation, and verifies accuracy against the actual code.

**Shape:** auditor → writer → checker → publisher
**Shared state:** `doc-plan.md`, `doc-report.md`, `progress.md`
**Example:** `examples/autodoc/`

### autosec

Security audit and hardening. Scans for OWASP top-10 vulnerabilities, dependency issues, secret leaks, and configuration weaknesses. Each finding is confirmed or dismissed with evidence, then fixed with standard security patterns.

**Shape:** scanner → analyst → hardener → reporter
**Shared state:** `sec-findings.md`, `sec-report.md`, `progress.md`
**Example:** `examples/autosec/`

### autoperf

Performance profiling and optimization. Identifies hot paths, establishes baselines, implements targeted optimizations, measures results, and keeps or discards changes — similar to autoresearch but scoped to performance.

**Shape:** profiler → optimizer → measurer → judge
**Shared state:** `perf-profile.md`, `perf-log.jsonl`, `progress.md`
**Example:** `examples/autoperf/`

## Naming guidance

**`autoimprove` is an umbrella concept, not a preset.** It describes what you get by composing `autoideas` → `autocode`: survey a repo for improvements, then implement them. There is no `autoimprove` preset because the composition is the point.

**`autoresearch` stays.** It is the only experiment/hypothesis loop in the family. The name fits because the cycle is: hypothesize → test → measure → decide.

**`autoqa` exists because validation is fundamentally different from test creation.**
- `autoqa` = "does what we have work?" — uses native/manual validation surfaces that already exist in the repo (build system, type checker, linter, REPL, CLI invocation, existing test suite, file output inspection).
- `autotest` = "do we have good tests?" — writes new formal tests, improves coverage, tightens the test suite.

**Naming convention:** all presets use the `auto` prefix followed by a single lowercase word that describes the behavioral center. No hyphens, no camelCase. The word should answer "what does this loop do in one word?" — code, ideas, research, qa, test, fix, review, doc, sec, perf.

## Choosing a preset

| You want to… | Use |
|---|---|
| Implement a feature or task | `autocode` |
| Survey a repo for improvement ideas | `autoideas` |
| Run experiments and measure results | `autoresearch` |
| Validate that things work without writing new tests | `autoqa` |
| Write or improve formal tests | `autotest` |
| Fix a specific bug | `autofix` |
| Review code changes | `autoreview` |
| Generate or update documentation | `autodoc` |
| Audit for security issues | `autosec` |
| Profile and optimize performance | `autoperf` |
