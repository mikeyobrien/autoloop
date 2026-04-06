# RFC: Dashboard `iteration.start` Routing Disclosure

## Summary

Improve the dashboard’s `iteration.start` event presentation so operators can see routing state and prompt structure without expanding a giant raw `fields` blob. The UI should treat `iteration.start` as a state-transition event, not a generic JSON packet.

Primary outputs:
- routing-first `iteration.start` summary lines
- flattened display of `iteration.start.fields`
- structured markdown rendering for the nested `fields.prompt` value
- focused dashboard tests covering the new rendering path

Code task: `.agents/tasks/dashboard/06-iteration-start-routing-and-prompt-rendering.code-task.md`

## Problem

Live inspection of the dashboard with `playwright-cli` showed that `iteration.start` still exposes the most useful information at the wrong layer.

Current behavior:
- the summary line is better than a raw topic, but still spends too much space repeating the objective
- expanding an `iteration.start` event shows `run`, `iteration`, `topic`, then a single collapsed `fields (13017 chars)` blob
- the routing data operators actually need is already inside that blob:
  - `recent_event`
  - `suggested_roles`
  - `allowed_events`
  - `backpressure`
  - `prompt`
- the dashboard already has a structured prompt renderer, but it only activates when the prompt is exposed as a top-level `prompt` field; live `iteration.start` events store it at `fields.prompt`

The result is that the dashboard has the right data but still makes operators dig through a serialized object to understand loop state.

## Goals

- Make `iteration.start` summaries routing-first and operator-readable.
- Surface `recent_event`, `suggested_roles`, `allowed_events`, and `backpressure` as first-class rows instead of one raw object.
- Reuse the existing prompt markdown/section renderer for the nested `fields.prompt` value.
- Preserve progressive disclosure: routing state visible immediately, full prompt still available, raw prompt still inspectable.
- Keep the change local to the dashboard shell unless a tiny helper extraction is clearly cleaner.

## Non-goals

- Changing journal event shape or adding a new server-side event projection API.
- Reworking all event rendering logic around a new generic schema.
- Adding iteration grouping, filters, or timeline mode in this slice.
- Revisiting unrelated dashboard metadata already improved in prior slices.

## Current State

For `iteration.start`, the current dashboard behavior is effectively:
- **summary:** `[iter 2] iteration.start → researcher — <objective preview>`
- **expanded body:** `run`, `iteration`, `topic`, `fields (N chars)`

That shape over-emphasizes the repeated task objective and under-emphasizes the routing handoff.

The handoff is the important part:
- what event routed here
- which role is expected next
- which event is allowed next
- whether backpressure is in effect

## Proposed Design

### 1. Flatten `iteration.start.fields` for display

In the dashboard shell, replace the purely generic `Object.entries(ev)` display for `iteration.start` with a display helper that expands `ev.fields` one level.

For `iteration.start`, the operator-visible rows should include:
- `recent_event`
- `suggested_roles`
- `allowed_events`
- `backpressure`
- `prompt`

This can be done with a small helper such as:
- `eventDisplayEntries(ev)` returning normalized entries for rendering, or
- a specialized `iterationStartDisplayEntries(ev)` called from the template when `topic === "iteration.start"`

Design constraints:
- only flatten one level; do not recursively normalize arbitrary event payloads in this slice
- keep generic rendering for other event types
- preserve the original event object in memory; this is a display concern, not a data rewrite

### 2. Reuse the existing structured prompt renderer for `fields.prompt`

The existing dashboard shell already has good prompt rendering primitives:
- `parsePromptSections()`
- `renderMarkdown()`
- `renderTopologyBlock()`
- scratchpad/history progressive disclosure

This slice should route the nested `fields.prompt` value through that existing renderer so the expanded `iteration.start` body becomes:
- Handoff / routing rows
- Objective
- Topology
- Scratchpad
- Loop Memory
- Config
- Harness Instructions
- Raw prompt toggle

Design constraints:
- the full prompt remains available behind a raw toggle
- markdown rendering should remain escaped/safe as it is today
- this slice should avoid introducing a second prompt parser

### 3. Make the summary routing-first

Change the `iteration.start` summary logic to prioritize state transition information.

Preferred summary shape:
- `[iter 2] iteration.start — brief.ready → researcher · emits research.ready`

Priority order for summary hints:
1. `recent_event`
2. `suggested_roles`
3. `allowed_events`
4. `backpressure` when non-empty
5. objective preview from the prompt only as a fallback when routing fields are missing

Design constraints:
- keep summaries compact enough for dense event lists
- if multiple roles or allowed events exist, render a short comma-separated form
- if backpressure is non-empty, surface it visibly instead of burying it in the expanded body

### 4. Render routing values with lightweight visual structure

Use small display affordances to make routing state scanable without adding a new UI subsystem:
- comma-split roles/events rendered as badges or chips
- empty backpressure rendered as `none` / muted
- non-empty backpressure rendered as a warning-styled row or badge

This should stay consistent with the dashboard’s current visual language:
- badge background for compact state tokens
- existing status colors where appropriate
- no new framework or component system

## Implementation Shape

Keep the change as one focused dashboard slice.

Primary file:
- `src/dashboard/views/shell.ts`

Expected supporting test file:
- `test/dashboard/pages.test.ts`

If the shell becomes materially cleaner by extracting a tiny pure helper module for event display normalization, that is allowed, but not required.

## Validation Strategy

The implementation should validate at three levels:

1. **Shell-level assertions**
   - `iteration.start` display logic references flattened routing fields
   - nested prompt rendering path is present for `fields.prompt`
   - summary logic uses routing-first hints

2. **Focused dashboard tests**
   - page test(s) assert the shell contains routing-first summary helpers and prompt-display hooks
   - if practical, add a small helper-focused test for normalized display entries

3. **Project validation gates**
   - `npm test -- test/dashboard/pages.test.ts`
   - `npm run build`
   - `npm test`

## Acceptance Criteria

- Expanding an `iteration.start` event no longer shows only a single opaque `fields (N chars)` object as the primary content.
- `recent_event`, `suggested_roles`, `allowed_events`, and `backpressure` are visible as first-class rendered fields.
- The nested `fields.prompt` value renders via the existing structured markdown prompt UI rather than a raw blob.
- The `iteration.start` summary is routing-first, with objective preview used only as fallback context.
- Raw prompt inspection remains available.
- Existing dashboard behavior for non-`iteration.start` events remains intact.

## Risks And Boundaries

- **Template complexity drift:** avoid making the generic event template unreadable; use small helpers if needed.
- **Prompt-rendering duplication:** do not fork the prompt parser for nested-vs-top-level prompt values.
- **Overreach:** this slice should not expand into event grouping, filtering, or server-side event reshaping.

## Open Questions

No product-level blockers remain. The main implementation decision is whether to normalize `iteration.start` display entries inline in `shell.ts` or extract a tiny helper for clarity.
