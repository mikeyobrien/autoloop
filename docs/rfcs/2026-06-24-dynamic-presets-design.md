# Dynamic autoloops: architect-generated presets

**Status:** Design (grilled 2026-06-24)
**Author:** Mikey O'Brien (via grilling session)
**Related:** evolves the existing `autopreset` preset; reuses chains, waves, evidence gates, registry, resume.

## Summary

Give autoloop the ability to **synthesize a bespoke preset, purpose-built for a user's
objective**, then run it through the unchanged engine — the autoloop analogue of Claude's
"ultracode + dynamic workflows." When a user runs `autoloop run --ultra "objective"` (or
`--architect` without `--ultra`), an **architect** step inspects the repo, composes a
single-file preset from a catalog of parameterizable stage templates, statically validates
it, and chains straight into executing it.

The dynamism lives entirely at **preset-construction time**. The runner gains no special
code path: it runs whatever preset it's handed. Everything that makes autoloop autoloop —
the append-only journal, `resume`, `inspect`, guards, gates, cost tracking — applies to a
generated preset exactly as to a bundled one.

## Motivation

Autoloop today runs a **single linear iteration loop** driven by a fixed preset
`topology.toml`, with one parallel escape hatch (`parallel.wave`, which fans out N
subprocesses **all running the same preset**). To get dynamic-workflow behavior — judge
panels, multi-lens verification, loop-until-dry discovery, finder pools, synthesis — a human
must hand-author a preset, and even then the topology can't express heterogeneous fan-out.

`autopreset` already generates presets from a rough idea (designer → generator → validator →
finalizer), but it: emits a **directory** preset, requires a **manual two-step** (generate,
then run it yourself), validates with an **LLM checklist** rather than a deterministic gate,
and only produces **linear role decks**. This design evolves `autopreset` into an
auto-chaining, fan-out-capable, statically-validated **architect**.

## Decisions (locked via grilling)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Authoring form | Model emits a **declarative preset**, not orchestration code |
| 2 | Relation to loop | Architect **self-constructs a bespoke preset** per prompt (not mid-loop plans) |
| 3 | Artifact | A **single-file preset** |
| 4 | Format | **Single merged TOML** (role prompts as triple-quoted strings) |
| 5 | Loader | **Native in-memory loader**, coexists with directory presets |
| 6 | Architect execution | A **bundled preset, chained** into the generated run (journaled, resumable, self-critiquing) |
| 7 | Validity | **Grounded generation + static topology validator** as a hard gate; regenerate on failure |
| 8 | Fan-out | **First-class parallel stages** in topology, reusing the wave spawn/join executor |
| 9 | Ultracode | **Intensity flag to the architect**; biases generation only, no engine mode |
| 10 | Budget | **Architect-proposed advisory target**; hard ceiling **opt-in** via `--budget`; **no default ceiling** |
| 11 | Overshoot | **Pre-admission reservation + per-branch timeout**, active only when an explicit ceiling is set |
| 12 | Approval | **Auto-run by default**, opt-in `--review`/`--dry-run`, architect may self-trigger HITL |
| 13 | Catalog | **Parameterizable stage templates** (judge-panel, finder-pool-until-dry, multi-lens-verify, …) |
| 14 | Join | **Named deterministic reducers** (vote/dedup/count/concat) + optional **synthesizer role** |
| 15 | Branch data | **Template-declared output schema + validate** (generalizes evidence-gate `requires`); invalid → null |
| 16 | Resume | **Branch-granular** — reuse completed branches, re-run only incomplete, then join |
| 17 | Concurrency | **Global run-wide semaphore** (default ~`min(8, cores−2)`); excess width queues |
| 18 | Architect inputs | **Objective + live repo inspection** + catalog/backends/budget/intensity |
| 19 | Surface | **Flag on `run`** (`--ultra` / `--architect`, preset optional) |
| 20 | Lifecycle | **Persist + promotable** (`preset promote <run-id> <name>`); no auto-cache |
| 21 | Quorum | **Per-template, kind-based default**: discovery proceeds on ≥1 survivor; verdict templates require a majority or emit `blocked` |
| 22 | Vote rule | **Majority + rejection bias**, ties/uncertainty reject, verifier prompts default to "refute when unsure," architect can raise to supermajority/unanimous per stage |

## Decision tree

The branches walked during grilling, the choice at each node, and the cross-dependencies.

```
dynamic autoloops ("ultracode + dynamic workflows" for autoloop)
│
├─ #1 WHO authors the orchestration? ........... declarative preset (not code)
│   │   └─ forces ─▶ #14 (no JS escape hatch ⇒ named reducers, not inline code)
│   │
│   ├─ #2 relation to the loop? ............... architect self-builds a bespoke preset per prompt
│   │   └─ builds on ─▶ existing `autopreset` (designer→generator→validator→finalizer)
│   │
│   ├─ #3 artifact? .......................... single-file preset
│   │   ├─ #4 format? ....................... single merged TOML (prompts as """…""")
│   │   └─ #5 loader? ....................... native in-memory; coexists w/ directory presets
│   │
│   └─ #6 what runs the architect? .......... bundled preset, CHAINED into the generated run
│       │   └─ enables ─▶ journaled · resumable · self-critique · cost-tracked
│       │
│       ├─ #7 validity? .................... grounded generation + STATIC validator gate (regen on fail)
│       │   └─ depends on ─▶ #13 (catalog) + #15 (seam schemas)
│       │
│       ├─ #13 catalog unit? .............. parameterizable stage TEMPLATES (validator checks seams)
│       │
│       ├─ #18 architect inputs? .......... objective + LIVE REPO INSPECTION + catalog/budget/intensity
│       │
│       └─ #8 fan-out? .................... first-class parallel stages (reuse wave spawn/join)
│           │
│           ├─ #15 branch data? .......... template-declared SCHEMA + validate (invalid → null)
│           │   └─ generalizes ─▶ existing evidence-gate `requires`
│           │
│           ├─ #14 join? ................. deterministic reducers (vote/dedup/count) + optional synthesizer role
│           │   ├─ #21 quorum? .......... per-template, kind-based (discovery ≥1 · verdict = majority-or-blocked)
│           │   └─ #22 vote rule? ....... majority + rejection bias; architect can raise to super/unanimous
│           │
│           ├─ #16 resume? .............. BRANCH-granular (reuse done branches, re-run only incomplete)
│           │
│           └─ #17 concurrency? ......... global run-wide semaphore (~min(8, cores−2)); excess queues
│
├─ #9 ultracode? ............................ intensity FLAG to architect (biases generation only; no engine mode)
│   │
│   └─ #10 budget? .......................... architect-proposed ADVISORY target · ceiling OPT-IN (--budget) · NO default
│       │       (split "target" from "ceiling"; chosen: unbounded-unless-explicit)
│       └─ #11 overshoot? ................. pre-admission reservation + per-branch timeout
│                                            ⚠ ONLY engages when an explicit ceiling is set;
│                                              else bounds = semaphore (#17) + max_iterations + max_runtime
│
├─ #12 approval? ............................ auto-run by default · opt-in --review/--dry-run · architect self-HITL
├─ #19 surface? ............................. flag on `run` (--ultra / --architect; preset optional)
└─ #20 lifecycle? ........................... persist to .autoloop/generated/<id>.toml · `preset promote` · no auto-cache
```

Cross-edges that drive the build order:

- **#1 → #14**: choosing *declarative-not-code* is what forces named reducers + a synthesizer
  role — there is no JS in which to write `votes.filter(...)`. The reducer set stays small
  because that is empirically all the patterns use.
- **#7 → #13/#15**: the static validator is cheap *because* templates are pre-validated and
  branch schemas pin the seams; it only checks where templates connect.
- **#10 → #11**: "unbounded unless explicit" demotes the pre-admission budget gate to
  conditional — with no `--budget`, dollars are not a bound; only turns/time/concurrency are.
- **#8 → #16/#17**: first-class fan-out is the node that drags in branch-granular resume and
  the global semaphore — neither matters until parallelism is real.

The three roots (#1 orchestration, #9 ultracode, the standalone UX trio #12/#19/#20) are
independent; everything else hangs off #1's subtree. That subtree order is also the build
order: format → validator → architect → fan-out, then #9's intensity/budget layer, then UX.

## Why a declarative preset, not model-authored code (#1)

Claude's Workflow tool lets the model author arbitrary JS (`parallel`/`pipeline`/loops) and
reduce results in plain code, because its subagents are **in-process, sandboxable functions**
returning schema-validated objects. Autoloop's "subagents" are **external CLI processes**
(`claude`, `pi`, `acp`) that can't be sandboxed the same way, and its entire value
proposition is the append-only journal + `resume` + `inspect`. Arbitrary model-authored code
would forfeit determinism and resumability and can't be safely sandboxed here. A declarative
preset preserves all of it: every stage journals and resumes.

The cost of that choice (#14): there is no JS escape hatch in which to write
`votes.filter(v => !v.refuted).length >= 2`. So the small, **fixed** set of reductions the
patterns empirically use is pre-built as **named reducers**, and the one genuinely-semantic
case (merge/synthesize) stays an LLM **synthesizer role**. This is the faithful translation
of Claude's "structural reduction = code, semantic synthesis = an extra agent" split into a
declarative, resumable engine — not a different design.

## End-to-end flow

```
autoloop run --ultra "harden the auth module"        # preset arg optional; --budget optional
  │
  ├─ chain link 1 — autoarchitect (bundled preset, evolves autopreset)
  │     • inspects repo (project type? tests? build? size? conventions?)        [#18]
  │     • composes catalog templates → single-file TOML preset                  [#3,#4,#13]
  │     • proposes an advisory $ target sized to objective + repo + intensity   [#9,#10]
  │     • static validator gates the topology  ──fail──▶ regenerate             [#7]
  │     • persist to .autoloop/generated/<run-id>.toml + journal a copy         [#20]
  │     • (--review pauses here to inspect/edit/approve; else auto-runs)        [#12]
  │
  └─ chain link 2 — run the generated preset (engine unchanged, native loader)  [#5,#6]
        • linear roles + first-class fan-out stages                            [#8]
        • global semaphore caps concurrent CLI branches; queue the rest        [#17]
        • pre-admission budget reservation IF an explicit --budget ceiling set  [#11]
        • each branch emits schema-validated structured output (invalid→null)   [#15]
        • per-template quorum on survivors                                      [#21]
        • deterministic reducer (vote/dedup/count) or synthesizer role joins    [#14,#22]
        • existing guards (stall, runtime, cost-if-set) + completion/evidence gates
  │
  ├─ resume <run-id> reuses completed branches, re-runs only incomplete         [#16]
  └─ preset promote <run-id> <name> turns a good design into a named preset     [#20]
```

## Component detail

### Single-file preset format (#3, #4, #5)

One merged TOML file carrying what is today split across `autoloops.toml` + `topology.toml` +
role markdown: `[event_loop]`, `[backend]`, `[[role]]` blocks (with inline
`prompt = """…"""`), `[handoff]`, `[[gate]]`, and the new fan-out stage constructs (#8). A
**native in-memory loader** parses it once into the same config + topology + role-prompt
structures the runner already consumes — no expansion to disk. Single-file presets are
first-class in `run` / `resume` / `inspect`, and humans may hand-write them. Directory presets
remain supported unchanged.

### Fan-out stages + reducers (#8, #13, #14, #15)

Topology gains first-class parallel stages: a stage declares a fan-out to either **K identical
instances** (judge panel) or **N distinct sub-roles/prompts** (multi-lens verify), executed
concurrently by the **existing wave spawn/join machinery**, each branch journaled. Each
fan-out template declares:

- an **output schema** every branch must satisfy (validated; generalizes the evidence-gate
  `requires` check from "keys present" to "conforms to schema"); a schema-invalid branch
  drops to `null` and is excluded from the reduction;
- a **join**: a named deterministic reducer (`majority-vote`, `dedup-by-key`,
  `count-threshold`, `concat`) — which costs no LLM call and is reproducible — or an optional
  **synthesizer role** (a normal backend iteration) for genuine semantic merge;
- a **quorum** (#21): discovery templates default to ≥1 survivor; verdict templates default to
  a majority of N or else emit the stage's `blocked`/`failed` event;
- for verdicts, a **vote rule** (#22): majority of survivors confirms, ties/uncertainty
  reject, verifier prompts default to "refute when unsure"; architect may raise to
  supermajority/unanimous.

### Grounding catalog (#13)

A curated library of **named, parameterizable stage templates** the architect selects and
wires — e.g. `planner→builder→critic`, `fan-out-verify`, `judge-panel(k, lenses)`,
`finder-pool-until-dry`, `multi-lens-verify`, `completeness-critic`, `synthesizer`. Each
template is independently authored and known-live, so the architect composes and parameterizes
rather than inventing event-name spaghetti, and the validator only checks the **seams** between
templates. The library grows over time, partly via `preset promote`.

### Static validator (#7)

A deterministic gate between architect and execution (complements, doesn't replace,
`autopreset`'s LLM validator). Check list (to finalize during implementation): every emitted
event has a handoff or is terminal; `loop.start` routes somewhere; the completion event is
reachable/emittable by some role; every gate's `requires` is satisfiable by an upstream role;
no orphan roles; fan-out branch schemas cohere at seams with their reducer. On failure, the
architect chain regenerates.

### Budget (#9, #10, #11)

`--ultra` is purely an intensity input to the architect: it biases generation toward wide
heterogeneous fan-out, multi-lens verification, loop-until-dry discovery, and higher iteration
ceilings. The architect proposes an **advisory dollar target** (sized to objective + repo +
intensity) used only to shape the workflow and shown in `--review`. There is **no default
dollar ceiling**; the hard ceiling is opt-in via `--budget X`, which populates the existing
`max_cost_usd` guard. When (and only when) a ceiling is set, fan-out uses **pre-admission
reservation**: before launching a stage, `remaining = ceiling − journaled_spend`; branches
that don't fit aren't launched. With no ceiling, the only bounds are the global concurrency
semaphore (#17), `max_iterations`, and `max_runtime`.

Honest contract: with external billed CLIs, a single call's cost is known only **after** it
reports usage, so a literal "never exceed $X" is impossible — the guarantee is "stop admitting
new work past the line," with overshoot bounded by one in-flight wave. Optional future
backstop: hard-kill in-flight branches at e.g. 1.2× a set ceiling.

### Concurrency (#17)

One configurable run-wide semaphore bounds concurrent branches across composed/nested fan-out
(default conservative — `min(8, cores−2)` — because each branch is a heavy CLI process and
provider rate limits apply). Templates declare desired width; the semaphore enforces the real
ceiling; excess branches queue and run as slots free, so a panel of 5 still fully completes.

### Resume (#16)

Each branch's launch and completion is journaled (the wave already collects per-branch
`result.json`). On resume, completed branches are reused from their journaled results and only
incomplete branches re-run before the join proceeds — protecting paid work on a mid-wave crash.

### Surface & lifecycle (#12, #19, #20)

`autoloop run --ultra "obj"` / `--architect "obj"`; the preset arg becomes optional and an
objective-without-preset routes to the architect chain. Composes with `--budget` and
`--review`. The generated preset is always written to `.autoloop/generated/<run-id>.toml` and
journaled; `--review`/`--dry-run` inspects/edits/approves before execution; otherwise it
auto-runs. `autoloop preset promote <run-id> <name>` graduates a good generated preset into a
permanent named one. No auto-cache/reuse by objective similarity.

## Open implementation questions

Resolve while building; none reopen the architecture above.

1. **Initial template set** shipped in v1 (which of the catalog templates land first).
2. **loop-until-dry state**: where the cross-round "seen" set lives (harness-maintained, keyed
   by template, journaled) and what counts as "dry" (default K=2 dry rounds).
3. **Validator check list**: the exact, final set of structural rules.
4. **Synthesizer invocation**: a wired role in the topology (leaning) vs. a reducer-typed step.
5. **Per-stage model assignment**: architect using existing per-role backend overrides to put
   cheap models on finders and strong models on synthesis.

## Implementation status (2026-06-24)

Built and tested (deterministic unit + end-to-end stub-backend):

- **Single-file merged-TOML presets** — native loader (`loadProjectFromFile` /
  `loadTopologyFromFile`), `PresetSource` resolution, coexisting with directory
  presets. **Runnable** (`autoloop run ./p.toml "obj"`) and **resumable**
  (`preset_file` persisted in the registry; `resume` reloads from it). Verified
  end-to-end with a stub backend.
- **Static validator** — `validateTopology` extended with completion-reachability,
  gate satisfiability, prompt-file-in-single-file, and fan-out stage seam checks.
- **Fan-out reduction primitives** (`core/fanout.ts`) — schema validation,
  quorum (kind-based), vote rule (majority + rejection bias, super/unanimous),
  dedup/concat/count reducers, and the `reduceStage` dispatcher. Fully unit-tested.
- **Fan-out stage topology** — `[[stage]]` parsing into `FanoutStage`, validator
  coverage.
- **Fan-out stage orchestrator** (`harness/fanout-runner.ts`) — branch expansion
  (K-identical / N-distinct), concurrency-bounded execution, per-branch failure
  isolation, reduction. The branch executor is injected (tested with a stub).
- **Global concurrency semaphore** (`core/concurrency.ts`) — `Semaphore` +
  `mapLimit`, default `min(8, cores−2)`.
- **autoarchitect preset** (`presets/autoarchitect.toml`, a single-file preset
  itself) + **`--ultra` / `--architect` / `--budget` flags** + **auto-chain**:
  `run --architect "obj"` designs a preset, statically validates it (refusing a
  dead topology), then runs it. Verified end-to-end (happy + refusal paths).
- **`preset promote <file> <name>`** — validates then installs a generated preset
  as a permanent named preset; promoted presets run by name.

Remaining live-backend integration (substrate complete, not yet loop-wired):

- **Fan-out stage execution in the iteration routing loop** — `runFanoutStage` is
  built and tested, but `iteration.ts` does not yet invoke stages on a routing
  event (the seam is the existing `parallelTriggerTopic` hook). Wiring it needs a
  real backend branch-runner and is the one piece not end-to-end verified. Until
  then the honesty gate holds: `validateTopology({singleFile:true})` emits
  `stage-not-executed` when a single-file preset defines `[[stage]]` blocks, so
  the auto-chain **refuses** an inert-fan-out preset rather than silently
  no-opping, and `autoarchitect` is instructed to generate sequential topologies
  (verification via critic roles + evidence gates) instead of stages.
- **Branch-granular resume of an interrupted wave** — resume reloads single-file
  presets; per-branch reuse within a wave depends on the executor above.
- The **architect's live LLM generation** quality is exercised only via the
  validator contract on stub output (by design — the gate is tested, not the model).

## Non-goals

- No model-authored orchestration code / JS escape hatch (deliberately rejected, #1/#14).
- No new execution engine — the runner is unchanged.
- No format migration of bundled directory presets (single-file coexists, #5).
- No auto-caching of generated presets (#20).
