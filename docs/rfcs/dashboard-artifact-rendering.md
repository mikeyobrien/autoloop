# RFC: Dashboard Artifact Rendering & Inline Comments

**Slug:** `dashboard-artifact-rendering`
**Status:** Draft
**Date:** 2026-04-07

## Summary

Define a YAML frontmatter convention for markdown artifacts (RFCs, code-tasks) so the dashboard can discover, render, comment on, and launch loops from them. The design adds: a frontmatter schema, a discovery module, three API endpoints, a sidecar comment format, and frontend components for rendering + interaction.

## Motivation

Autospec produces RFCs and code-tasks as markdown files, but the dashboard has no awareness of them. Operators must manually find files, read them in an editor, and copy-paste prompts to run them. This creates friction between the spec and implementation phases of the loop lifecycle.

---

## Design

### 1. Frontmatter Schema

All new artifacts produced by autospec (and other loops) should include YAML frontmatter:

```yaml
---
type: rfc                          # required: "rfc" | "code-task"
slug: dashboard-artifact-rendering # required: unique identifier
title: Dashboard Artifact Rendering # required: human-readable title
status: draft                      # required: "draft" | "approved" | "implemented" | "superseded"
date: 2026-04-07                   # required: creation date
preset: autocode                   # optional: preset to use for "Run" button
run_id: run-abc123                 # optional: run that produced this artifact
depends_on:                        # optional: slugs this artifact depends on
  - backend-adapters
objective: |                       # optional: one-liner for "Run" button prompt
  Implement dashboard artifact rendering with frontmatter discovery
---
```

**Required fields:** `type`, `slug`, `title`, `status`, `date`
**Optional fields:** `preset`, `run_id`, `depends_on`, `objective`

**Backward compatibility:** Files without frontmatter are still discoverable. The discovery module falls back to parsing bold-text metadata from the body (`**Slug:**`, `**Status:**`, etc.) and infers `type` from the file path (`docs/rfcs/` → `rfc`, `.agents/tasks/` → `code-task`).

### 2. Artifact Discovery Module

New file: `src/dashboard/artifacts.ts`

```typescript
interface ArtifactMeta {
  type: "rfc" | "code-task";
  slug: string;
  title: string;
  status: string;
  date: string;
  preset?: string;
  run_id?: string;
  depends_on?: string[];
  objective?: string;
  path: string;           // relative to projectDir
  commentCount: number;   // from sidecar file
  unresolvedCount: number;
}

interface ArtifactDetail extends ArtifactMeta {
  body: string;           // markdown content with frontmatter stripped
  comments: Comment[];    // from sidecar file
}
```

Discovery logic:
1. Scan `docs/rfcs/*.md` and `.agents/tasks/**/*.code-task.md` under `projectDir`
2. For each file, attempt YAML frontmatter parse (between `---` delimiters)
3. If no frontmatter, fall back to regex extraction of `**Slug:**`, `**Status:**`, `**Date:**` from first 20 lines
4. Read companion `.comments.json` sidecar if it exists
5. Return sorted by date descending

**Frontmatter parsing:** No new dependency. YAML frontmatter is simple key-value pairs — a ~30-line parser handles the `---`-delimited block and splits `key: value` lines. Complex YAML (nested objects, arrays) uses the already-available `@iarna/toml`-style simple parsing or inline JSON for `depends_on`.

Actually, simpler: since `depends_on` is the only array field, the parser can handle `depends_on: [a, b]` as a special case or use JSON.parse for bracket-delimited values. All other fields are scalar strings.

### 3. API Endpoints

Added to `src/dashboard/routes/api.ts`:

#### `GET /api/artifacts`

Returns all discovered artifacts with metadata (no body content).

```json
{
  "artifacts": [
    {
      "type": "rfc",
      "slug": "dashboard-artifact-rendering",
      "title": "Dashboard Artifact Rendering",
      "status": "draft",
      "date": "2026-04-07",
      "preset": "autocode",
      "path": "docs/rfcs/dashboard-artifact-rendering.md",
      "commentCount": 3,
      "unresolvedCount": 1
    }
  ]
}
```

#### `GET /api/artifacts/:slug`

Returns full artifact detail including body and comments.

```json
{
  "type": "rfc",
  "slug": "dashboard-artifact-rendering",
  "title": "Dashboard Artifact Rendering",
  "status": "draft",
  "body": "## Summary\n\nDefine a YAML frontmatter...",
  "comments": [
    { "id": "c1", "line": 42, "text": "Needs error handling", "author": "local", "timestamp": "2026-04-07T10:00:00Z", "resolved": false }
  ],
  "preset": "autocode",
  "objective": "Implement dashboard artifact rendering",
  "path": "docs/rfcs/dashboard-artifact-rendering.md"
}
```

#### `POST /api/artifacts/:slug/comments`

Adds a comment to the sidecar file.

Request:
```json
{ "line": 42, "text": "This needs error handling for the edge case" }
```

Response:
```json
{ "id": "c-1712500000000", "line": 42, "text": "...", "author": "local", "timestamp": "2026-04-07T10:00:00Z", "resolved": false }
```

#### `PATCH /api/artifacts/:slug/comments/:id`

Updates a comment (resolve/unresolve or edit text).

Request:
```json
{ "resolved": true }
```

### 4. Comment Sidecar Format

Comments live in a `.comments.json` file adjacent to the artifact:

```
docs/rfcs/my-rfc.md              → docs/rfcs/my-rfc.comments.json
.agents/tasks/proj/01-foo.code-task.md → .agents/tasks/proj/01-foo.code-task.comments.json
```

Schema:
```json
[
  {
    "id": "c-1712500000000",
    "line": 42,
    "text": "This section needs error handling for network failures",
    "author": "local",
    "timestamp": "2026-04-07T10:30:00Z",
    "resolved": false
  }
]
```

- `id`: timestamp-based unique ID (`c-` prefix + `Date.now()`)
- `line`: 1-based line number in the body (after frontmatter stripping). Line 0 means "general comment on the whole artifact"
- `author`: always `"local"` (no auth; future: could use git user.name)
- `resolved`: toggled by user or automatically when a loop addresses it

The sidecar file is created on first comment. If the team wants to exclude comments from git, they add `*.comments.json` to `.gitignore`.

### 5. Comment-to-Loop Submission

When a user clicks "Submit comments for resolution", the dashboard:

1. Collects all unresolved comments from the sidecar
2. Composes a prompt:
   ```
   Address review comments on <artifact-path>

   Comments to resolve:
   - [line 42] "This needs error handling for network failures"
   - [line 78] "Consider using a Map instead of object here"
   ```
3. Sets `selectedPreset` to the artifact's `preset` field (default: `autofix` for RFCs, `autocode` for code-tasks)
4. Injects into the chatbox (`newPrompt` + `selectedPreset`) and focuses the textarea
5. User can edit the prompt before hitting Start

This is a "pre-fill, don't auto-submit" pattern — the user always has final control.

### 6. "Run" Button

Each artifact card in the dashboard shows a "▶ Run" button. Clicking it:

1. Reads `preset` from frontmatter (falls back to `autocode` for code-tasks, `autospec` for RFCs)
2. Reads `objective` from frontmatter. If absent, uses the artifact title
3. Composes prompt: `Implement the spec at <path>\n\n<objective>`
4. Sets `selectedPreset` and `newPrompt` in the Alpine data model
5. Focuses the chatbox textarea

For code-tasks specifically, the prompt references the task file:
```
Execute the code task at .agents/tasks/dashboard-artifact-rendering/01-scaffold.code-task.md
```

### 7. Frontend Components

All within the existing `shell.ts` Alpine.js SPA (no new files for the current dashboard):

**Artifacts tab/section:** A new collapsible `<details>` section (like the existing run categories) showing discovered artifacts grouped by type (RFCs, Code Tasks).

**Artifact detail pane:** Replaces the run detail pane when an artifact is selected. Shows:
- Metadata header (title, status badge, date, preset)
- Rendered markdown body (reusing `renderMarkdown()`)
- Line-number gutter with comment indicators
- Comment sidebar/popover on click
- Action buttons: "▶ Run", "💬 Submit Comments"

**Comment input:** Clicking a line number opens an inline textarea. Submit saves via `POST /api/artifacts/:slug/comments`. Resolve button calls `PATCH`.

**For the ASAI React dashboard:** The same API endpoints work. React components would be `<ArtifactList>`, `<ArtifactDetail>`, `<CommentThread>` — consuming the same JSON. The design is frontend-agnostic.

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/dashboard/artifacts.ts` | New: discovery module, frontmatter parser, comment read/write |
| `src/dashboard/routes/api.ts` | Add 4 artifact endpoints |
| `src/dashboard/views/shell.ts` | Add artifacts section, detail pane, comment UI |
| `test/dashboard/artifacts.test.ts` | New: unit tests for discovery + frontmatter parsing |
| `test/dashboard/api.test.ts` | Add artifact endpoint tests |
| `docs/rfcs/dashboard-artifact-rendering.md` | This RFC (with frontmatter — dogfooding) |

## Migration

No migration needed. Existing RFCs without frontmatter are discovered via fallback parsing. New artifacts produced by autospec will include frontmatter once the planner role prompt is updated to emit it (separate task, not part of this RFC's implementation scope).
