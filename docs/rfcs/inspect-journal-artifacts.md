# RFC: Inspect Journal & Artifacts

**Status:** Draft
**Slug:** inspect-journal-artifacts

## Summary

Upgrade `autoloop inspect journal` from a raw JSON dump into a filterable, color-coded, human-readable event timeline. Add a new `autoloop inspect artifacts` subcommand that shows an at-a-glance summary of everything a run produced. Add corresponding dashboard panels (journal explorer with search/filter, artifacts overview card with stats and charts).

## Motivation

The current `inspect journal` outputs raw JSONL — useful for machine consumption but hard to scan visually. Operators troubleshooting runs need to quickly browse events by topic or iteration without piping through `jq`. There's also no summary view of what a run actually produced (event counts, memory learnings, guidance stats, commits). Both gaps exist in the CLI and dashboard.

## Design

### CLI: `inspect journal` (upgrade)

```
autoloop inspect journal [--run <id>] [--topic <pattern>] [--iter <n>] [--all-runs] [--json] [--format <fmt>]
```

**Default output:** Color-coded terminal timeline grouped by iteration.

```
── iter 1 ─────────────────────────────────────────────────
  12:04:01  loop.start       run-abc123 started (preset: autospec, max: 100)
  12:04:02  iteration.start  role: clarifier → allowed: brief.ready
  12:05:33  brief.ready      "Brief complete. Handed off to researcher..."
  12:05:33  iteration.finish exit_code=0, elapsed=91.4s

── iter 2 ─────────────────────────────────────────────────
  12:05:34  iteration.start  role: researcher → allowed: research.ready
  ...
```

**Flags:**
- `--run <id>` — resolve by prefix (default: latest). Uses `mergedFindRunByPrefix()`.
- `--topic <pattern>` — filter by topic. Supports exact (`loop.start`), category (`loop`), glob (`slice.*`). Multiple = OR.
- `--iter <n>` — show only events from iteration N.
- `--all-runs` — merge all journals. Mutually exclusive with `--run`.
- `--json` — raw JSON lines (backward-compat alias for `--format json`).
- `--format` — `terminal` (default, colored), `json`, `md`, `text`.

**Color mapping** (respects `NO_COLOR` / `FORCE_COLOR`):

| Category | Color | Topics |
|---|---|---|
| loop | cyan | `loop.*` |
| iteration | yellow | `iteration.*` |
| backend | dim/gray | `backend.*` |
| review | magenta | `review.*` |
| coordination | blue | `issue.*`, `slice.*`, `context.*`, `chain.*` |
| operator | bright red | `operator.*` |
| routing/wave | dim blue | `wave.*`, custom topics |
| error | red + bold | `event.invalid`, `loop.stop` |

**Formatting rules:**
- Iteration separator lines using `─` box-drawing chars.
- Timestamp: `HH:MM:SS` local timezone from event `ts`/`timestamp`.
- Topic: left-padded to 20 chars for alignment.
- Summary: one-line contextual extract, truncated to terminal width or 80 chars.
- System events (no iteration) grouped under `── system ──` separator.

### CLI: `inspect artifacts` (new)

```
autoloop inspect artifacts [--run <id>] [--format <fmt>]
```

**Default output:**

```
Run: run-abc123 (autospec, completed)
Duration: 25m 14s (12 iterations)

Events
  total           47
  loop            3    (start, complete, stop)
  iteration       24   (12 start + 12 finish)
  backend         10
  review          4
  coordination    2
  operator        2
  routing/wave    2
  errors          0

Artifacts
  scratchpad      12 entries (4.2 KB)
  memory          8 learnings, 3 meta, 0 preferences
  guidance        2 sent, 2 consumed
  backpressure    1 rejected event

Output
  files changed   14
  commits         3
  journal size    128 KB
```

**Data sources:** All derived from journal lines + `statsProject()` for memory + `fs.statSync()` for journal size. Commits extracted from `slice.committed` events. No `git log` integration in v1.

### Dashboard: Journal Explorer Panel

Adds a tab bar to the run detail pane: `[Events] [Journal] [Artifacts]`.

**Journal tab features:**
- **Search box:** Client-side text search across event fields/payloads (debounced 300ms).
- **Topic filter chips:** Clickable category toggles with count badges and colored borders. Backend off by default (follows `showVerbose` pattern).
- **Iteration grouping:** Collapsible `<details>` sections per iteration.
- **Event expansion:** Click any row to expand full payload with markdown rendering.

No new API endpoint — reuses existing `GET /api/runs/:id/events` with client-side filtering.

### Dashboard: Artifacts Overview Card

**Artifacts tab features:**
- **Stat cards:** 4-card grid (events, iterations, memory, guidance) with counts.
- **Category bar chart:** Pure CSS horizontal bars proportional to event counts, colored by category.
- **Commit list, files changed, journal size, backpressure count.**
- **Refresh button** for active runs (data fetched once, not polled).

**New API endpoint:** `GET /api/runs/:id/artifacts` — returns aggregated `RunArtifacts` JSON. Server-side aggregation needed for filesystem access (memory stats, journal size).

## Architecture

### New files

| File | Purpose |
|---|---|
| `src/cli/color.ts` | ANSI color utility, `NO_COLOR`/`FORCE_COLOR` aware, no deps |
| `src/harness/journal-format.ts` | `eventOneLiner()`, `formatTimeline()`, `topicMatchesFilter()`, `topicCategory()` |
| `src/harness/artifacts.ts` | `RunArtifacts` interface, `collectArtifacts()`, `formatArtifacts()` |

### Modified files

| File | Changes |
|---|---|
| `src/commands/inspect.ts` | Add `"artifacts"` to `INSPECT_TARGETS`, parse `--topic`/`--iter`/`--all-runs`/`--json` flags, wire new render functions |
| `src/harness/index.ts` | Add `renderJournalTimeline()`, `renderArtifacts()` facade functions |
| `src/dashboard/routes/api.ts` | Add `GET /api/runs/:id/artifacts` and `GET /api/runs/:id/artifact?path=` endpoints |
| `src/dashboard/views/shell.ts` | Add tab bar, journal explorer panel, artifacts card, Alpine.js state/methods, CSS |
| `src/usage.ts` | Add `artifacts` row, update `journal` docs with new flags |

### Data flow

```
Journal (JSONL) → decodeEvent() → filter/group → formatTimeline() → terminal output
Journal (JSONL) → decodeEvent() → collectArtifacts() → formatArtifacts() → terminal output
Journal (JSONL) → /api/runs/:id/events → client-side filter → journal explorer panel
Journal (JSONL) → collectArtifacts() → /api/runs/:id/artifacts → artifacts card
Journal (JSONL) → artifact.created events → document list → /api/runs/:id/artifact?path= → rendered markdown
Worktree (.md files) → frontmatter scan → fallback document list
```

### InspectSpec changes

```typescript
interface InspectSpec {
  artifact: string;
  selector: string;
  projectDir: string;
  format: string;
  run?: string;
  // New fields:
  topics?: string[];     // --topic (repeatable)
  iterFilter?: string;   // --iter
  allRuns?: boolean;     // --all-runs
}
```

## Agent-Generated Document Artifacts

### Problem

Agents produce markdown documents during runs — RFCs, specs, reports, task files — that silently appear in the worktree or `.autoloop/` directory. There's no record of what was written, no discoverability, and no way to render them from the dashboard or CLI without knowing the exact path.

### Design: Two-layer approach

#### Layer 1: Journal event (source of truth)

When an agent writes a significant markdown file, the emit tool records an `artifact.created` event:

```jsonl
{"run":"stable-context","iteration":"4","topic":"artifact.created","fields":{"path":"docs/rfcs/inspect-journal-artifacts.md","kind":"rfc","title":"Inspect Journal & Artifacts","format":"markdown"}}
```

**Fields:**
- `path` — relative to the run's work directory
- `kind` — categorization: `rfc`, `spec`, `task`, `report`, `design`, `research`, `other`
- `title` — human-readable title extracted from the document's first `#` heading or frontmatter
- `format` — file format, typically `markdown`

This event is emitted by the harness emit tool when the agent calls it with `topic: artifact.created`. It requires no new infrastructure — it uses the existing event schema.

#### Layer 2: Frontmatter convention (optional enrichment)

Any `.md` file with autoloop frontmatter is self-describing and discoverable outside the journal:

```markdown
---
autoloop:
  run: stable-context
  kind: rfc
  iteration: 4
---
# RFC: Inspect Journal & Artifacts
```

Frontmatter is optional — the journal event is sufficient for discoverability. Frontmatter makes files meaningful when encountered outside the dashboard (e.g., browsing the repo, reviewing a PR).

### CLI: `inspect artifacts` additions

The artifacts summary gains a **Documents** section:

```
Documents
  docs/rfcs/inspect-journal-artifacts.md   rfc       "Inspect Journal & Artifacts"
  .autoloop/spec-design.md                 design    "Design: inspect-journal-artifacts"
  .agents/tasks/cli-journal.code-task.md   task      "CLI Journal Timeline"
```

New flag: `--documents` / `-d` — show only the documents list (useful for scripting).

**Data source:** Collect `artifact.created` events from journal lines. Fallback: scan worktree for `.md` files with `autoloop:` frontmatter if no journal events found.

### Dashboard: Artifacts tab additions

The artifacts tab gains a **Documents** card below the stats:

```
┌─────────────────────────────────────────────────────────┐
│ Documents                                                │
│                                                         │
│ 📄 Inspect Journal & Artifacts          rfc     [View]  │
│ 📄 Design: inspect-journal-artifacts    design  [View]  │
│ 📄 CLI Journal Timeline                task    [View]   │
│                                                         │
│ Click [View] to read rendered markdown                  │
└─────────────────────────────────────────────────────────┘
```

**[View] behavior:** Opens an inline markdown reader panel within the dashboard. The rendered content replaces the artifacts tab content with a back button to return to the summary.

### API endpoint

**New endpoint:** `GET /api/runs/:id/artifact?path=<relative-path>`

Returns the file content with `Content-Type: text/markdown`. The dashboard renders it client-side using the existing `renderMarkdown()` function.

**Security:** Path must be within the run's work directory. Reject traversal attempts (`..`). Only serve `.md` files.

### Emit tool integration

The `artifact.created` event is emitted when the agent explicitly calls the emit tool:

```
emit artifact.created path=docs/rfcs/foo.md kind=rfc title="My RFC"
```

Presets that produce documents (autospec, autoresearch, autoideas, autodoc) should include guidance in their harness/role prompts to emit this event when writing artifacts. This is a convention, not enforcement — runs without `artifact.created` events simply show no documents in the artifacts view.

### Frontmatter scanning (fallback)

When no `artifact.created` events exist in the journal, `collectArtifacts()` falls back to scanning the worktree for `.md` files containing `autoloop:` frontmatter in their YAML front matter block. This handles cases where:
- The agent wrote files but didn't emit events
- The journal was lost or truncated
- Files were written by older runs before this convention existed

Scanner uses a simple regex on the first 20 lines of each `.md` file — no full YAML parser dependency.

## Edge cases

- **Empty journal:** Print `"No journal events found."` and exit 0.
- **No matching filters:** Print `"No events match the given filters."`.
- **Events without timestamp:** Show `--:--:--` placeholder.
- **Memory file not found:** Show `"memory: (not found)"` in artifacts.
- **Run still active:** Show current counts with `"(run still active)"` note.
- **No `slice.committed` events:** Show `commits: 0`, `files changed: -`.
- **`--all-runs` + `--iter`:** Filters iter N within each run.
- **Very long payloads:** Truncate to 120 chars in timeline; full content via `--json`.
- **Artifact file deleted:** `artifact.created` event exists but file is gone — show path with `(missing)` label.
- **Path traversal in artifact API:** Reject paths containing `..` or absolute paths. Return 400.
- **Non-markdown artifact:** Only serve `.md` files from the artifact endpoint. Return 415 for other types.
- **No `artifact.created` events and no frontmatter:** Documents section omitted from output (not an error).

## Constraints

- Journal path resolution via `config.resolveJournalFileIn()` / `config.resolveMemoryFileIn()`, not hardcoded paths (per mem-18).
- Dashboard follows Hono.js + Alpine.js patterns. All UI in `shell.ts` template string.
- Color output respects `NO_COLOR` / `FORCE_COLOR` env vars and TTY detection.
- New `artifact.created` topic added to event schema; no changes to journal write path.
- No real-time streaming (dashboard polls existing mechanism).
- No cross-run analytics except `--all-runs` for journal.
