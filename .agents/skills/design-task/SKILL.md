---
name: design-task
description: Generate a paired RFC-style design doc and .code-task.md in the correct repo locations. Use when turning a rough feature or workflow idea into durable design + executable implementation artifacts.
kind: sop
---

# Design Task

## Overview

Create one or two linked planning artifacts from a rough idea:
- an RFC-style design doc for durable product/architecture intent
- a `.code-task.md` for implementation execution

Default output locations:
- Design doc: `docs/rfcs/<slug>.md`
- Code task: `.agents/tasks/<project-name>/<slug>.code-task.md`

This skill is for ideas that are important enough to preserve as both:
- a decision/design artifact
- an implementation-ready task

Use the smallest artifact set that fits:
- create **both** when the idea needs design reasoning and execution guidance
- create **design only** when the direction is still being shaped
- create **task only** when design is already settled

## Parameters

- **input** (required): Rough idea, design notes, conversation summary, or path to a source doc.
- **mode** (optional, default: `both`): One of `both`, `design`, or `task`.
- **title** (optional): Human-readable document/task title. If omitted, derive from the input.
- **slug** (optional): Kebab-case artifact slug. If omitted, derive from the title.
- **design_dir** (optional, default: `docs/rfcs`): Directory for the RFC-style doc.
- **task_dir** (optional, default: `.agents/tasks/<project-name>`): Directory for the code task.
- **project_name** (optional): Project name used for the task directory. If omitted, infer from the repo/cwd name.
- **references** (optional): Extra repo files, docs, or notes that should be linked as references.
- **implementation_scope** (optional): Extra guidance about how much implementation detail the code task should contain.

## Steps

### 1. Gather inputs and determine artifact scope

**Constraints:**
- You MUST gather all missing required inputs up front rather than one-by-one.
- You MUST determine whether the request should produce `both`, `design`, or `task` output.
- You MUST infer `title`, `slug`, and `project_name` when they are not provided.
- You MUST normalize `slug` to kebab-case.
- You MUST prefer the default output locations unless the user explicitly asks for different ones.
- If the input is a file path, you MUST read it before drafting artifacts.

### 2. Inspect repo conventions before drafting

**Constraints:**
- You MUST inspect existing repo patterns before writing files.
- You MUST look for existing `.code-task.md` files to match task tone and structure.
- You MUST look for existing `docs/` conventions before choosing the exact RFC-style doc shape.
- You MUST keep artifacts git-friendly, explicit, and inspectable.
- You MUST avoid creating a new planning system when an existing directory convention already exists.

### 3. Draft the RFC-style design doc when requested

**Constraints:**
- When `mode` is `both` or `design`, you MUST create a design doc at `<design_dir>/<slug>.md`.
- The design doc MUST be concise by default.
- The design doc SHOULD include these sections when relevant:
  1. `# <Title>`
  2. `## Summary`
  3. `## Problem`
  4. `## Goals`
  5. `## Non-goals`
  6. `## Proposed Design`
  7. `## UX / File Layout / CLI` (when relevant)
  8. `## Alternatives Considered`
  9. `## Open Questions`
  10. `## Implementation Notes`
- The design doc MUST explain tradeoffs and boundaries, not just restate requirements.
- When a code task is also generated, the design doc MUST include an explicit cross-link line in `## Implementation Notes` using this wording: `Code task: \`<task path>\``.
- The design doc MUST avoid excessive ceremony; prefer a lightweight RFC style over heavyweight process language.

### 4. Draft the code task when requested

**Constraints:**
- When `mode` is `both` or `task`, you MUST create a code task at `<task_dir>/<slug>.code-task.md`.
- The code task MUST follow the repo's established `.code-task.md` structure if one exists.
- The code task MUST be implementation-facing: concrete requirements, dependencies, approach, and acceptance criteria.
- When a design doc is also generated, the code task MUST include the design doc under `Reference Documentation` using a path-form entry such as `- Design: <design path>`.
- The code task MUST preserve important design decisions as implementation constraints.
- The code task MUST keep tests and verification integrated into acceptance criteria rather than as a separate afterthought.
- When a design doc is also generated, the code task MUST link back to it in `Reference Documentation` or `Background`; do not leave the pair unlinked.

### 5. Keep the pair aligned

**Constraints:**
- When generating both artifacts, you MUST ensure they describe the same feature and boundaries.
- The design doc MUST explain **why this design**.
- The code task MUST explain **what to build and how to tell it is done**.
- You MUST avoid duplicating long prose between the two files when a short cross-reference is clearer.
- You MUST keep names, paths, and terminology consistent across both artifacts.

### 6. Write the artifacts

**Constraints:**
- You MUST write files to the canonical artifact paths:
  - design doc: `docs/rfcs/<slug>.md` by default
  - code task: `.agents/tasks/<project-name>/<slug>.code-task.md` by default
- You MUST create parent directories when missing.
- If the default RFC directory does not exist, you MUST create `docs/rfcs/` rather than inventing a different docs location.
- You MUST use markdown files only.
- You MUST not write extra summary files, logs, or indexes unless the user asks.

### 7. Validate before finishing

**Constraints:**
- You MUST verify that any generated design doc includes the key decision sections needed to understand the proposal.
- You MUST verify that any generated code task includes implementation requirements and acceptance criteria.
- You MUST verify that cross-links between the design doc and code task are correct when both were created.
- You MUST verify that output paths match repo conventions.
- You SHOULD mention the exact created paths in the final response.

## Output

When done, report:
- Created file path(s)
- Mode used (`both`, `design`, or `task`)
- Title and slug
- A one-line summary of what each artifact is for

## Templates

### RFC-style design doc template

```markdown
# <Title>

## Summary
<One-paragraph summary of the proposal>

## Problem
<What is awkward or missing today>

## Goals
- <goal>

## Non-goals
- <non-goal>

## Proposed Design
<Core model, constraints, ordering, file layout, and behavior>

## Alternatives Considered
- <alternative>: <why not chosen>

## Open Questions
- <question>

## Implementation Notes
- Code task: `<task path>`
```

### Code task expectations

Use the repo's existing `.code-task.md` format. At minimum include:
- task title
- description
- background
- reference documentation
- technical requirements
- dependencies
- implementation approach
- acceptance criteria
- metadata

When both artifacts are generated, include the design doc path in `Reference Documentation` and the code task path in the design doc's `## Implementation Notes`.

## Example

Input:
- `input`: "Add runtime-selectable profiles for preset role tuning, with repo defaults and inspect support"
- `mode`: `both`
- `slug`: `profiles-for-preset-role-tuning`

Output:
- `docs/rfcs/profiles-for-preset-role-tuning.md`
- `.agents/tasks/<project-name>/profiles-for-preset-role-tuning.code-task.md`

Suggested usage:
- `/skill:design-task Add runtime-selectable profiles for preset role tuning`
