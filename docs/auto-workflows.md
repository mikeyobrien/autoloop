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

## Future-facing presets

These are documented as the natural next members of the family. They are not yet implemented.

### autotest

Formal test creation and test-suite tightening. Where autoqa validates using whatever native surfaces already exist, autotest writes new tests: unit tests, integration tests, property tests, coverage gap analysis.

### autofix

Bug diagnosis and repair. Narrower than autocode — starts from a bug report or failing test rather than a feature request. Focuses on root-cause analysis, minimal fix, and regression verification.

### autoreview

Code review loop. Reads a PR diff or set of changes, checks for correctness, style, security, and performance issues, and produces structured review feedback.

### autodoc

Documentation generation and maintenance. Audits existing docs against the codebase, identifies gaps and staleness, and writes or updates documentation.

### autosec

Security audit and hardening. Scans for OWASP top-10 vulnerabilities, dependency issues, secret leaks, and configuration weaknesses. Produces a prioritized findings report.

### autoperf

Performance profiling and optimization. Identifies hot paths, runs benchmarks, proposes optimizations, measures results, and keeps or discards changes — similar to autoresearch but scoped to performance.

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
| Write or improve formal tests | `autotest` (future) |
| Fix a specific bug | `autofix` (future) |
| Review code changes | `autoreview` (future) |
| Generate or update documentation | `autodoc` (future) |
| Audit for security issues | `autosec` (future) |
| Profile and optimize performance | `autoperf` (future) |
