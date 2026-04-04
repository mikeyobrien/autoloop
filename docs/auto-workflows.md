# Auto Workflow Family

Autoloop ships a family of `auto*` preset workflows. Each one is a self-contained agentic loop with a distinct behavioral center, topology, and shared-state contract. This document is the canonical taxonomy.

Presets are the primary product surface of the autoloop control plane. New workflows are added as preset directories — not as code changes to the runtime. See [Platform Architecture](platform.md) for how presets fit into the broader system.

Across the family, the intended posture is fail-closed rather than rubber-stamp: verifier, checker, judge, reporter, and final-gate roles should prefer explicit evidence, surface uncertainty, and reject weak proof instead of quietly approving work.

## Implemented presets

### autocode

Code implementation loop. Takes a task description (prose, `.code-task.md` path, or existing implementation directory), breaks it into slices, builds each slice, reviews, and gates completion. The critic is expected to independently manual-smoke the builder's changed code path whenever a practical executable surface exists.

**Shape:** planner → builder → critic → finalizer
**Shared state:** `.autoloop/context.md`, `.autoloop/plan.md`, `.autoloop/progress.md`, `.autoloop/logs/`
**Example:** `presets/autocode/`

### autospec

Specification loop. Takes a rough idea, local note, or draft spec and turns it into a durable RFC + `.code-task.md` pair. Clarifies scope first, inspects repo conventions and adjacent code/docs, drafts the design doc, drafts the implementation task, and adversarially checks that the pair is aligned and executable.

**Shape:** clarifier → researcher → designer → planner → critic
**Shared state:** `.autoloop/spec-brief.md`, `.autoloop/spec-research.md`, `.autoloop/progress.md`
**Example:** `presets/autospec/`

### autosimplify

Post-implementation cleanup loop. Focuses on recently modified code, identifies safe opportunities to improve reuse, clarity, and obvious efficiency, applies behavior-preserving simplifications, and independently verifies that the result is actually cleaner.

**Shape:** scoper → reviewer → simplifier → verifier
**Shared state:** `.autoloop/simplify-context.md`, `.autoloop/simplify-plan.md`, `.autoloop/progress.md`
**Example:** `presets/autosimplify/`

### autoideas

Repository survey and improvement report. Scans a target repo for areas worth improving, deep-dives each area, validates suggestion quality, and compiles an actionable report.

**Shape:** scanner → analyst → reviewer → synthesizer
**Shared state:** `.autoloop/scan-areas.md`, `.autoloop/progress.md`, `.autoloop/ideas-report.md`
**Example:** `presets/autoideas/`

### autoresearch

Autonomous experiment loop. Hypothesize, implement, measure, keep or discard. Supports LLM-as-judge for semantic evaluation when hard metrics are insufficient.

**Shape:** strategist → implementer → benchmarker → evaluator
**Shared state:** `.autoloop/autoresearch.md`, `.autoloop/experiments.jsonl`, `.autoloop/progress.md`
**Example:** `presets/autoresearch/`

### autoqa

Native, zero-dependency validation orchestration. Inspects the target repo, infers its domain, selects the idiomatic validation surface, writes a validation plan, and executes it — all without installing external test frameworks.

**Shape:** inspector → planner → executor → reporter
**Shared state:** `.autoloop/qa-plan.md`, `.autoloop/qa-report.md`, `.autoloop/progress.md`
**Example:** `presets/autoqa/`

### autotest

Formal test creation and test-suite tightening. Surveys the codebase for coverage gaps, writes new tests using the repo's existing framework and conventions, runs them, and assesses quality improvement.

**Shape:** surveyor → writer → runner → assessor
**Shared state:** `.autoloop/test-plan.md`, `.autoloop/test-report.md`, `.autoloop/progress.md`
**Example:** `presets/autotest/`

### autofix

Bug diagnosis and repair. Narrower than autocode — starts from a bug report or failing test rather than a feature request. Reproduces the issue, traces the root cause, implements a minimal fix, and verifies with regression checks.

**Shape:** diagnoser → fixer → verifier → closer
**Shared state:** `.autoloop/bug-report.md`, `.autoloop/fix-log.md`, `.autoloop/progress.md`
**Example:** `presets/autofix/`

### autoreview

Code review loop. Reads a PR diff or set of changes, checks for correctness, security, style, performance, and maintainability issues, proposes concrete fixes, and produces structured review feedback with a clear verdict.

**Shape:** reader → checker → suggester → summarizer
**Shared state:** `.autoloop/review-context.md`, `.autoloop/review-findings.md`, `.autoloop/progress.md`
**Example:** `presets/autoreview/`

### autodoc

Documentation generation and maintenance. Audits existing docs against the codebase, identifies gaps and staleness, writes or updates documentation, and then adversarially verifies accuracy against the actual code before publishing.

**Shape:** auditor → writer → checker → publisher
**Shared state:** `.autoloop/doc-plan.md`, `.autoloop/doc-report.md`, `.autoloop/progress.md`
**Example:** `presets/autodoc/`

### autosec

Security audit and hardening. Scans for OWASP top-10 vulnerabilities, dependency issues, secret leaks, and configuration weaknesses. Each finding is confirmed or dismissed with evidence, then fixed with standard security patterns.

**Shape:** scanner → analyst → hardener → reporter
**Shared state:** `.autoloop/sec-findings.md`, `.autoloop/sec-report.md`, `.autoloop/progress.md`
**Example:** `presets/autosec/`

### autoperf

Performance profiling and optimization. Identifies hot paths, establishes baselines, implements targeted optimizations, measures results, and keeps or discards changes — similar to autoresearch but scoped to performance.

**Shape:** profiler → optimizer → measurer → judge
**Shared state:** `.autoloop/perf-profile.md`, `.autoloop/perf-log.jsonl`, `.autoloop/progress.md`
**Example:** `presets/autoperf/`

## Naming guidance

**`autoimprove` is an umbrella concept, not a preset.** It describes what you get by composing `autoideas` → `autocode`: survey a repo for improvements, then implement them. There is no `autoimprove` preset because the composition is the point.

**`autoresearch` stays.** It is the only experiment/hypothesis loop in the family. The name fits because the cycle is: hypothesize → test → measure → decide.

**`autoqa` exists because validation is fundamentally different from test creation.**
- `autoqa` = "does what we have work?" — uses native/manual validation surfaces that already exist in the repo (build system, type checker, linter, REPL, CLI invocation, existing test suite, file output inspection).
- `autotest` = "do we have good tests?" — writes new formal tests, improves coverage, tightens the test suite.

**Naming convention:** all presets use the `auto` prefix followed by a single lowercase word that describes the behavioral center. No hyphens, no camelCase. The word should answer "what does this loop do in one word?" — code, spec, simplify, ideas, research, qa, test, fix, review, doc, sec, perf.

## Choosing a preset

| You want to… | Use |
|---|---|
| Turn a rough idea into an RFC + implementation task | `autospec` |
| Implement a feature or task | `autocode` |
| Clean up a recent diff without changing behavior | `autosimplify` |
| Survey a repo for improvement ideas | `autoideas` |
| Run experiments and measure results | `autoresearch` |
| Validate that things work without writing new tests | `autoqa` |
| Write or improve formal tests | `autotest` |
| Fix a specific bug | `autofix` |
| Review code changes | `autoreview` |
| Generate or update documentation | `autodoc` |
| Audit for security issues | `autosec` |
| Profile and optimize performance | `autoperf` |
