# Task: Build Auto Workflow Family With Native AutoQA

## Description
Create a coherent `auto*` workflow family for miniloops by reusing and extending the existing example presets. Add a new `autoqa` preset for native, zero-dependency, domain-adaptive agentic manual validation, and define how the rest of the family fits together without overbuilding the runtime.

## Background
The repo already has three `auto*` examples with clear behavioral centers:
- `examples/autocode` — implementation loop
- `examples/autoideas` — repo survey / improvement report loop
- `examples/autoresearch` — experiment / measure / keep-discard loop

The next step is to turn those into a coherent family and add the missing workflows that users would expect. The most important new addition is `autoqa`, which must not depend on `expect-cli` or any other external testing framework. Instead, the agent should inspect the target repo, infer the domain, choose the idiomatic validation surface, write a validation plan, and execute it using the repo's native/manual testing workflows.

Use Facebook Research HyperAgents as design inspiration for task/meta layering and context hygiene, but keep the implementation miniloops-native and lightweight.

## Reference Documentation
**Required:**
- Design: `README.md`
- Design: `examples/autocode/README.md`
- Design: `examples/autoideas/README.md`
- Design: `examples/autoresearch/README.md`
- Design: `harness.md`
- Design: `hyperagent.md`

**Additional References (if relevant to this task):**
- `https://github.com/facebookresearch/HyperAgents`
- `https://github.com/facebookresearch/HyperAgents/blob/main/task_agent.py`
- `https://github.com/facebookresearch/HyperAgents/blob/main/meta_agent.py`
- `https://github.com/facebookresearch/HyperAgents/blob/main/run_meta_agent.py`

**Note:** You MUST read the existing preset docs before beginning implementation. Use the HyperAgents materials for architecture inspiration only; do not port them literally.

## Technical Requirements
1. Audit the current `auto*` presets and classify them by actual behavior rather than just their names.
2. Define and document a coherent top-10 `auto*` workflow family for the repo.
3. Keep `autocode`, `autoideas`, and `autoresearch` unless research shows a name is clearly misleading.
4. Add a new `examples/autoqa/` preset for native, zero-dependency, domain-adaptive agentic manual validation.
5. Ensure `autoqa` does not require `expect-cli` or any other external test framework dependency.
6. Make `autoqa` responsible for selecting the validation approach based on the target repo's domain (web, backend, CLI, TUI, gamedev, library, etc.).
7. Distinguish `autoqa` from `autotest`: `autoqa` is native/manual validation orchestration, while `autotest` is for formal test creation and test-suite tightening.
8. Add a taxonomy doc under `docs/` explaining the family, which presets are implemented now, which are future-facing, and whether `autoimprove` is only an umbrella term.
9. Update `README.md` to explain the `auto*` family and link to the taxonomy doc.
10. Reuse existing example structure aggressively; prefer example presets and prompt/topology design over core engine changes.
11. Keep Pi as the default real adapter and preserve command-mode only for mock/debug or one-off backend override cases.
12. Validate with `tonic check .`.

## Dependencies
- Existing example preset structure under `examples/`
- Existing miniloops config, topology, harness, and role prompt conventions
- Existing docs and README structure
- HyperAgents repo materials for research and naming/architecture inspiration
- Tonic validation via `tonic check .`

## Implementation Approach
1. Audit the existing `auto*` examples and write down their true behavioral roles.
2. Research HyperAgents and extract only the ideas that fit miniloops cleanly, especially task/meta layering and context hygiene.
3. Create a taxonomy doc under `docs/` describing the top-10 `auto*` family and how current presets map into it.
4. Implement `examples/autoqa/` as the first new concrete preset.
5. Add or scaffold the remaining family members where doing so is low-cost and coherent, prioritizing reuse over novelty.
6. Update the root README so a new user can tell which `auto*` preset to choose and why.
7. Re-read all changed docs and examples, then run `tonic check .`.

## Acceptance Criteria

1. **Taxonomy Documentation Exists**
   - Given the repo after the change
   - When a reader opens the new `docs/` taxonomy document
   - Then they can see the top-10 `auto*` workflow family, which presets are implemented now, which are future-facing, and how the current presets fit the family

2. **Current Presets Are Classified Truthfully**
   - Given the existing `examples/autocode`, `examples/autoideas`, and `examples/autoresearch` presets
   - When their behavior is documented
   - Then each preset is described according to what it actually does rather than vague branding

3. **Native AutoQA Preset Exists**
   - Given the `examples/` directory
   - When the implementation is complete
   - Then `examples/autoqa/` exists with a coherent miniloops example structure (`README.md`, `miniloops.toml`, `topology.toml`, `harness.md`, and role prompts)

4. **AutoQA Is Zero-Dependency By Default**
   - Given the `autoqa` preset docs and harness instructions
   - When the validation approach is described
   - Then it explicitly avoids requiring `expect-cli` or other external testing-framework dependencies and instead uses native repo/domain validation surfaces

5. **AutoQA Is Domain-Adaptive**
   - Given a target repo of varying domains
   - When the `autoqa` preset is used
   - Then its instructions tell the agent to inspect the repo, infer the domain, choose the idiomatic validation mode, and record what was tested, what passed, what failed, and reproduction steps

6. **AutoQA And AutoTest Are Clearly Distinguished**
   - Given the family documentation and example READMEs
   - When a reader compares `autoqa` and `autotest`
   - Then it is clear that `autoqa` is native/manual validation orchestration and `autotest` is for formal tests and test-suite improvements

7. **README Explains The Family**
   - Given the root `README.md`
   - When a new user reads the workflow-family section
   - Then they can understand the role of `autocode`, `autoideas`, `autoresearch`, `autoqa`, and the other suggested `auto*` workflows

8. **Naming Guidance Is Opinionated And Concrete**
   - Given the taxonomy and README updates
   - When they discuss naming
   - Then they clearly state whether `autoresearch` stays, whether `autoimprove` is only an umbrella term, and why `autoqa` exists as a separate preset

9. **Validation Passes**
   - Given the repo after all changes
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: High
- **Labels**: miniloops, presets, naming, docs, autoqa, workflow-family, examples
- **Required Skills**: prompt design, documentation design, information architecture, Tonic app conventions, miniloops preset design, repo pattern reuse
