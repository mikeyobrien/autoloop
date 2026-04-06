# RFC: Progressive Disclosure of File Changes & Tool Calls

**Slug:** `progressive-activity-disclosure`  
**Status:** Draft  
**Date:** 2026-04-06  
**Phase:** Design

---

## Summary

Add structured capture of file changes and tool calls to `iteration.finish` journal events, then surface them progressively in the terminal (compact summary line + `inspect activity` drill-down) and dashboard (collapsible `<details>` sections within event detail views).

---

## Motivation

Today, tool calls and file modifications are buried in a monolithic `output` string on `iteration.finish` events. Understanding what an agent *did* requires reading hundreds of lines of raw backend output. This RFC introduces structured activity data and progressive disclosure so users can scan a summary and drill into details on demand.

---

## Design

### 1. Data Capture Layer

#### 1a. File Changes — `captureFileChanges()`

A new module `src/harness/activity.ts` provides file change capture via git:

```ts
interface FileChange {
  path: string;
  op: "modified" | "added" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
}

interface ActivitySummary {
  files: FileChange[];
  filesSummary: string;        // "3 files changed, +45 -12"
  toolCalls: ToolCallEntry[];
  toolsSummary: string;        // "5 tool calls: 2x Edit, 2x Read, 1x Bash"
}
```

**Mechanism:** Run `git diff --stat HEAD` before and after each iteration. Parse the diff-stat output into `FileChange[]`. For worktree-isolated runs, this is exact. For sequential (non-parallel) runs, this captures cumulative changes — acceptable for v1.

**Edge cases:**
- Untracked files: include via `git diff --stat HEAD` + `git ls-files --others --exclude-standard`
- No git: return empty `files[]` with `filesSummary: "git unavailable"`
- Parallel non-worktree: return `filesSummary: "unavailable in parallel mode"`

#### 1b. Tool Calls — `parseToolCalls()`

Parse tool call names from backend stdout. Claude Code outputs tool calls with recognizable headers (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, etc.).

```ts
interface ToolCallEntry {
  name: string;
  argsSummary: string;   // truncated first arg or key param, max 120 chars
}
```

**Parsing strategy:** Regex-based extraction from the `output` string in `BackendRunResult`. Pattern: tool name headers followed by parameter blocks. This is best-effort — non-Claude backends return empty `toolCalls[]` with `toolsSummary: "tool data unavailable"`.

**No timing data in v1.** Per-tool timestamps require streaming execution (currently `execSync`), deferred to v2.

### 2. Journal Schema Changes

Add four fields to `iteration.finish` events (additive, backward-compatible):

| Field | Type | Example |
|-------|------|---------|
| `files_changed` | JSON string | `[{"path":"src/foo.ts","op":"modified","insertions":12,"deletions":3}]` |
| `files_summary` | string | `"2 files changed, +15 -3"` |
| `tool_calls` | JSON string | `[{"name":"Edit","argsSummary":"src/foo.ts:42"}]` |
| `tool_summary` | string | `"4 tool calls: 2x Edit, 1x Read, 1x Bash"` |

These are string-valued fields in the `FieldsEvent.fields` record (existing schema). The `rawFields` property carries pre-parsed objects for in-memory consumers.

**Integration point:** `appendIterationFinish()` in `src/harness/parallel.ts` (lines 368-387) gains an `ActivitySummary` parameter.

### 3. Terminal Disclosure

#### 3a. Iteration Footer — Compact Summary

Extend `printIterationFooter()` in `src/harness/display.ts` to append activity summary lines:

```
──── end iteration 3 (42s) ────────────────────────────
  files: 2 changed (+15 -3)  tools: 4 calls (2x Edit, 1x Read, 1x Bash)
```

- Only shown when `decorativeOutputEnabled()` is true (TTY mode)
- Omitted when no activity data is available (graceful degradation)

#### 3b. `inspect activity` — Drill-Down

Add `"activity"` to `INSPECT_TARGETS` in `src/commands/inspect.ts`:

```
autoloops inspect activity [--run <id>]
```

Reads `iteration.finish` events from the journal, extracts `files_changed` and `tool_calls` fields, and renders a per-iteration breakdown:

```
## Iteration 1 (researcher)
Files: 2 changed (+15 -3)
  M src/harness/activity.ts  +12 -3
  A src/harness/parsers.ts   +45 -0
Tools: 4 calls
  Edit  src/harness/activity.ts:42
  Edit  src/harness/activity.ts:58
  Read  src/backend/types.ts
  Bash  npm test

## Iteration 2 (builder)
...
```

Formats: `--format terminal` (default, human-readable), `--format json` (raw event fields).

### 4. Dashboard Disclosure

#### 4a. Event Summary Enrichment

In `eventSummary()` (dashboard `shell.ts`), append activity hints to `iteration.finish` summaries:

```
iteration.finish | iter 3 | exit 0 | 42s | 2 files, 4 tools
```

This is a short inline hint — no click needed.

#### 4b. Collapsible Detail Sections

When rendering `iteration.finish` event fields, add two collapsible sections *before* the raw output section:

**Files Changed:**
```html
<details class="event-field activity-files">
  <summary>Files Changed (2 files, +15 -3)</summary>
  <table>
    <tr><td>M</td><td>src/harness/activity.ts</td><td>+12 -3</td></tr>
    <tr><td>A</td><td>src/harness/parsers.ts</td><td>+45 -0</td></tr>
  </table>
</details>
```

**Tool Calls:**
```html
<details class="event-field activity-tools">
  <summary>Tool Calls (4 calls: 2x Edit, 1x Read, 1x Bash)</summary>
  <table>
    <tr><td>Edit</td><td>src/harness/activity.ts:42</td></tr>
    <tr><td>Edit</td><td>src/harness/activity.ts:58</td></tr>
    <tr><td>Read</td><td>src/backend/types.ts</td></tr>
    <tr><td>Bash</td><td>npm test</td></tr>
  </table>
</details>
```

**Rendering rules:**
- Sections default to collapsed (consistent with existing `<details>` pattern for large fields)
- If `files_changed` or `tool_calls` is empty/missing, omit that section entirely
- Reuse existing CSS classes (`.event-field`) plus new `.activity-files`, `.activity-tools`

### 5. Module Structure

```
src/harness/activity.ts    — captureFileChanges(), parseToolCalls(), buildActivitySummary()
src/harness/display.ts     — printIterationFooter() extended
src/commands/inspect.ts    — "activity" target added
src/dashboard/views/shell.ts — renderActivitySection() added
```

No new modules beyond `activity.ts`. All other changes are extensions to existing files.

---

## Boundaries & Non-Goals

- **No streaming:** Backend execution remains `execSync`. Real-time tool call events deferred to v2.
- **No full diff viewer:** File changes show diff-stat (insertions/deletions count), not unified diff content.
- **No backend modification:** Tool call parsing is post-hoc from stdout. No protocol changes.
- **No timing:** Per-tool duration requires streaming; deferred.
- **No pagination:** Dashboard renders all activity inline. Lazy-load deferred if payload size becomes an issue.

---

## Backward Compatibility

- New fields on `iteration.finish` are additive. Existing consumers that destructure known fields are unaffected.
- `FieldsEvent.fields` is `Record<string, string>` — new string fields are schema-compatible.
- Terminal output adds lines only when TTY is detected. Non-TTY (machine-parseable) output unchanged.
- Dashboard gracefully omits activity sections when fields are absent (older journals).

---

## Open Questions (resolved)

| # | Question | Resolution |
|---|----------|------------|
| 1 | Claude Code output format stability | Best-effort regex parsing with graceful degradation. No version pinning needed — missing data shown as "unavailable" |
| 2 | Per-iteration vs per-run capture | Per-iteration via git diff delta |
| 3 | New topic vs field extension | Additive fields on `iteration.finish` — no topology changes |
| 4 | Tool call timing | Deferred to v2 (requires streaming) |
| 5 | Parallel/worktree | Worktree: clean capture. Non-worktree parallel: "unavailable" message |

## Remaining Open Questions

1. **Dashboard payload size:** Tool call data increases event size. Monitor in practice; add lazy-load if needed.
2. **Git diff accuracy:** Without commits between iterations, diffs are cumulative approximations. Acceptable for v1 — stash-snapshot upgrade path exists if precision needed.
