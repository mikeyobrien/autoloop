# Task: Add Dynamic Chain Generation For Bounded Open-Ended Execution

## Description
Design and implement the next stage of first-class loop chaining so an LLM can dynamically create and select preset chains at runtime, enabling open-ended self-improvement through bounded autonomous episodes. The system should support chain generation and execution as durable, inspectable, journaled data while preserving hard limits on depth, runtime, fan-out, and quality.

The goal is not literal infinite uncontrolled recursion. The goal is a system that can keep improving until interrupted by running a long-lived sequence of bounded, inspectable, resumable chain episodes with explicit budgets, lineage, and quality gates.

## Background
Autoloops already has or is planned to have:
- preset-based loop execution (`autocode`, `autoideas`, `autoresearch`, `autoqa`, etc.)
- a journal-first runtime model
- git-durable state in markdown/jsonl/toml
- a likely first-class chaining layer using `chains.toml` and CLI-defined chain composition

The next step is to allow a meta-level orchestrator to:
- choose among existing chains
- define new chains dynamically
- spawn bounded chain episodes
- inspect outcomes and lineage
- keep improving over time without losing inspectability or control

The design should remain faithful to repo tenets:
- keep the core as simple as possible
- let LLMs do the heavy lifting
- keep context and memory first-class
- store durable state in git-friendly formats
- avoid hidden behavior and overbuilt orchestration frameworks

## Reference Documentation
**Required:**
- Design: `AGENTS.md`
- Design: `README.md`
- Design: `src/main.tn`
- Design: `src/harness.tn`
- Design: `src/config.tn`
- Design: any implementation or design files for first-class loop chaining (`chains.toml`, chain CLI support, handoff/result contracts, etc.)
- Design: `hyperagent.md`
- Design: `.agents/tasks/tonic-loops/first-class-loop-chaining.code-task.md`
- Design: `.agents/tasks/tonic-loops/journal-first-runtime-simplification.code-task.md`

**Additional References (if relevant to this task):**
- `.agents/tasks/tonic-loops/auto-workflows-family.code-task.md`
- current `examples/auto*/` preset docs
- any chain or journal projection docs added while implementing prior tasks
- HyperAgents materials relevant to task/meta separation and self-improvement

**Note:** Keep the design bounded and inspectable. Do not implement unconstrained recursive self-spawning.

## Technical Requirements
1. Add a meta-level mechanism that can select existing chains and define new chains dynamically at runtime.
2. Represent dynamic chains as explicit durable data, not only transient prompt text.
3. Preserve a clear split between:
   - preset topology (intra-loop role routing)
   - chain orchestration (inter-loop preset composition)
   - meta orchestration (dynamic chain planning/selection/spawning)
4. Ensure dynamically generated chains are constrained by explicit budgets and policies.
5. Add budget controls for at least:
   - max chain depth
   - max steps per chain
   - max runtime per chain
   - max child chains / descendants
   - max consecutive failures or no-op chains
6. Add chain lineage tracking so every child chain records its parent and ancestry.
7. Add structured handoff/result artifacts for dynamically generated chains.
8. Add journal events for dynamic chain definition, spawning, step lifecycle, completion, pruning, and failure.
9. Add quality gates so new chains are spawned only when justified by evidence rather than raw recursion.
10. Keep dynamic chain generation constrained to known preset vocabulary unless a very strong repo-grounded case is documented.
11. Prefer bounded autonomous episodes over uncontrolled forever loops.
12. Design the system so it can be resumed and inspected from files on disk.
13. Validate with `tonic check .`.

## Dependencies
- First-class loop chaining support (`chains.toml`, chain execution, handoff/result contract)
- Existing journal-first runtime model
- Existing preset family and preset resolution model
- Existing hyperagent/meta-review concepts
- Existing repo tenets around inspectability, git-durable state, and narrow core / rich presets

## Implementation Approach
1. Define a clear meta-orchestration model above ordinary chains.
2. Introduce dynamic chain specs as durable files/data rather than ephemeral prompt-only constructions.
3. Add a constrained chain-planning layer that can:
   - choose an existing chain
   - or define a new chain from known preset vocabulary
4. Add hard budget envelopes and stop conditions to every chain episode.
5. Add lineage-aware journal events and artifacts for chain creation and execution.
6. Add quality gating rules for when a new chain may be created or spawned.
7. Ensure child chain state is isolated and inspectable.
8. Add docs explaining that “open-ended” means a sequence of bounded autonomous episodes, not literal unconstrained infinity.
9. Re-read the changed docs and runtime files, then run `tonic check .`.

## Acceptance Criteria

1. **Dynamic Chains Are Durable Data**
   - Given a chain created at runtime by the orchestrator
   - When it is inspected after the run
   - Then the chain exists as explicit durable data or files rather than only prompt text that disappeared after execution

2. **Meta Orchestration Is Separate From Topology**
   - Given the runtime model after implementation
   - When a reader inspects preset topology and chain orchestration
   - Then it is clear that intra-loop role flow, inter-loop preset composition, and dynamic chain planning are separate layers

3. **Budgeted Open-Ended Execution Is Enforced**
   - Given a long-running self-improvement session
   - When it creates or executes chains
   - Then every chain episode is bounded by explicit limits on depth, steps, runtime, and fan-out

4. **Chain Lineage Is Inspectable**
   - Given a child chain spawned from another chain
   - When a reader inspects the journal or artifacts
   - Then they can identify parent chain, ancestry, and why the child chain was created

5. **Chain Quality Gates Exist**
   - Given the orchestrator considering spawning another chain
   - When the prior chain produced weak, redundant, or no-op outcomes
   - Then the system has a documented and implemented mechanism to stop, consolidate, retry narrowly, or refuse unjustified further spawning

6. **Known Preset Vocabulary Is Constrained**
   - Given a dynamically generated chain
   - When it is created by the orchestrator
   - Then its composition is constrained to known/allowed presets unless a clearly documented extension path exists

7. **Handoff And Result Contracts Remain Structured**
   - Given one chain episode handing off to the next
   - When artifacts are inspected
   - Then the handoff/result remain structured, durable, and understandable from files on disk

8. **Open-Ended Means Bounded Episodes**
   - Given the docs and implementation
   - When a contributor reads the system description
   - Then it is clear that the design supports long-lived improvement through resumable bounded episodes rather than literal unbounded recursion

9. **The Core Remains Simple Enough To Audit**
   - Given the implementation
   - When reviewed against repo tenets
   - Then it does not become a giant scheduler/plugin platform and remains inspectable from runtime files, journal events, and durable artifacts

10. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: High
- **Labels**: autoloops, dynamic-chains, meta-orchestration, open-ended-execution, journal, lineage, budgets, self-improvement
- **Required Skills**: orchestration design, event schema design, Tonic app development, runtime budget design, information architecture, autonomous systems safety and control
