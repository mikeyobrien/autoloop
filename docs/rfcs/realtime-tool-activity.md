# RFC: Realtime Tool Activity via Structured Backend Adapters

**Slug:** `realtime-tool-activity`  
**Status:** Draft  
**Date:** 2026-04-06  
**Phase:** Design  
**Depends on:** `backend-adapters`, `progressive-activity-disclosure`

---

## Summary

Use the structured adapter/event pipeline from [`backend-adapters`](./backend-adapters.md) to provide realtime tool activity for backends that support it, starting with Claude. This RFC does **not** define the adapter architecture itself. Instead, it defines how structured backend events feed:

- live terminal tool activity
- realtime `tool.start` / `tool.finish` journal entries
- stable `iteration.finish.tool_calls` / `tool_summary` fields already established by `progressive-activity-disclosure`

Claude is the first structured backend implementation. Non-structured backends continue to rely on the post-hoc fallback from `progressive-activity-disclosure`.

---

## Layering

This RFC sits above two lower layers:

1. **`backend-adapters`**
   - adapter interface
   - adapter registry / resolution
   - normalized invocation model
   - parser model
   - normalized backend event union
   - generic async executor

2. **`progressive-activity-disclosure`**
   - stable activity fields on `iteration.finish`
   - terminal footer summary
   - `inspect activity`
   - dashboard rendering for activity data

This RFC only specifies how structured adapter events, primarily from Claude, populate and improve those existing activity surfaces.

---

## Motivation

`progressive-activity-disclosure` gives us the right public contract for activity, but its fallback tool capture is post-hoc and limited:

1. **No live feedback** — tool activity is only visible after the iteration ends.
2. **No timing data** — regex parsing from buffered output cannot reliably measure tool duration.
3. **Fragile extraction** — output scraping is backend-dependent and best-effort.

Once `backend-adapters` exists, structured backends can emit normalized `tool_start` / `tool_finish` events during execution. This RFC uses those events to improve UX and journal fidelity without changing the stable downstream schema.

---

## Design

### 1. Event Source

Structured adapters emit `NormalizedBackendEvent` values during execution. This RFC cares primarily about:

```ts
{ type: "tool_start", name, argsSummary, startedAt }
{ type: "tool_finish", name, argsSummary, durationMs, isError }
```

The harness must consume these normalized events only. It must not parse Claude raw event names here.

### 2. Claude as First Structured Backend

Claude is the first backend expected to produce structured tool events through its adapter/parser.

Responsibilities of the Claude adapter belong to `backend-adapters`:
- choose the correct Claude structured-stream flags
- parse raw Claude NDJSON
- sanitize `argsSummary`
- map raw backend output into normalized events

This RFC assumes those normalized events already exist when they reach harness code.

### 3. Journal Integration

During execution, structured tool events produce additive system-topic entries:

```jsonl
{"topic":"tool.start","fields":{"name":"Edit","args_summary":"src/foo.ts"}}
{"topic":"tool.finish","fields":{"name":"Edit","args_summary":"src/foo.ts","duration_ms":"412","is_error":"false"}}
```

Rules:
- `tool.start` and `tool.finish` are system topics, not routing topics
- they must not affect `latestAgentEventRecord()` or completion logic
- they are emitted only when structured tool events are available

### 4. Stable `iteration.finish` Contract

Structured tool events also populate the same batched fields introduced by `progressive-activity-disclosure`:

- `tool_calls`
- `tool_summary`

Source priority:

1. structured adapter events
2. post-hoc fallback parsing from buffered output
3. empty / unavailable summary

This is the key compatibility rule. Dashboard, inspect, and footer code should keep reading the same fields regardless of the data source.

### 5. Terminal Realtime Display

When TTY output is enabled, structured tool events are shown live during iteration execution.

Example:

```text
━━━ iteration 3/20 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⟳ Read src/harness/types.ts
  ✓ Read src/harness/types.ts (0.2s)
  ⟳ Edit src/harness/parallel.ts
  ✓ Edit src/harness/parallel.ts (0.4s)
──── end iteration 3 (42s) ────────────────────────────
  files: 2 changed (+15 -3)  tools: 4 calls (2x Edit, 1x Read, 1x Bash)
```

Rules:
- TTY only
- one line per tool event is sufficient initially
- non-TTY mode keeps existing behavior
- footer summary remains sourced from `tool_summary`

### 6. Dashboard and Inspect Surfaces

No new dashboard or inspect schema is introduced here.

This RFC improves the data source only:
- `inspect activity` continues reading `iteration.finish.tool_calls`
- dashboard activity details continue reading `iteration.finish.tool_calls` / `tool_summary`

### 7. Completion Compatibility

Completion semantics remain unchanged:
- event-based completion still depends on agent-emitted routing events
- promise-based completion still depends on the final accumulated output
- `backend.finish` / `iteration.finish` still carry full output

Structured tool events are additive observability, not control-flow signals.

---

## Phasing

| Layer | RFC | Purpose |
|---|---|---|
| L0 | `backend-adapters` | execution architecture and normalized event model |
| L1 | `progressive-activity-disclosure` | stable activity schema and presentation |
| L2 | `realtime-tool-activity` | structured-event enhancement for supported backends |

Implementation order:

1. ship `progressive-activity-disclosure`
2. implement `backend-adapters`
3. wire Claude structured events into the existing activity contract

---

## Open Questions

1. Which exact Claude CLI flags should the Claude adapter use for structured streaming?
2. Should live assistant text also be surfaced, or only tool activity initially?
3. Do any other current backends have enough structure to become second-wave structured adapters?

---

## Backward Compatibility

- Non-structured backends keep using post-hoc activity capture.
- Existing activity consumers continue reading the same `iteration.finish` fields.
- Realtime tool journal entries are additive.
- No routing or completion semantics change.

---

## Rejected Approach

### Duplicating adapter architecture here

Rejected. The adapter interface, executor, parser model, async migration, and backend resolution belong in `backend-adapters`. This RFC should stay focused on consuming structured events for activity disclosure.
