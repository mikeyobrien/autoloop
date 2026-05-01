# Dashboard

The dashboard is a browser-based operator UI for monitoring and launching autoloop runs. It serves a lightweight Alpine.js SPA from a local Hono HTTP server, backed by the same registry and journal data that the CLI reads — no new storage or data model.

## Quick start

```bash
autoloop dashboard
```

Opens at `http://127.0.0.1:4800`. The server runs in the foreground; Ctrl-C stops it.

## Command flags

```
autoloop dashboard [options]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `4800` | HTTP listen port |
| `--host` | | `127.0.0.1` | Bind address |
| `--project-dir` | | `.` | Project root for registry/journal resolution |
| `--help` | `-h` | | Show usage |

The `--host` flag defaults to localhost. Binding to `0.0.0.0` exposes the dashboard to the network and enables an `Origin` header check on API routes.

## UI layout

The SPA has four zones:

1. **Header** — title and last-updated timestamp.
2. **Chat box** — preset dropdown, prompt textarea, and Start button. Submit with the button or `Cmd/Ctrl+Enter`.
3. **Run list** — collapsible sections grouped by health status: active, watching, stuck, failed, completed. Each entry shows run ID prefix, preset, iteration count, latest event, and age. Worktree runs display a `WT` badge; merged worktrees show a checkmark.
4. **Detail pane** — appears when a run is clicked. Shows status, preset, objective, iteration, workspace path, timestamps, duration, and merge info (for worktree runs). Below, an events timeline lists journal entries with color-coded left borders by category (system, backend, review, error, coordination, completion). A "Show backend events" toggle controls verbose event visibility.

### Event rendering

Events in the detail pane are rendered as collapsible `<details>` elements. Fields are displayed as key-value pairs with special handling for:

- **Prompt fields** — parsed into structured sections (objective, topology, scratchpad, memory, rules, config, harness) with a "Show raw prompt" toggle.
- **Routing fields** — rendered as inline badges.
- **Markdown fields** — rendered as formatted HTML via a built-in markdown renderer.

## API routes

All routes are under `/api/` and return JSON. The SPA polls these on a 3-second interval.

### `GET /api/runs`

Returns all runs categorized by health status using the same `categorizeRuns()` logic as `autoloop loops`.

Response buckets: `active`, `watching`, `stuck`, `recentFailed`, `recentCompleted`. Each run record includes worktree merge metadata when applicable.

### `GET /api/runs/:id`

Returns a single run by ID or prefix match.

| Status | Response |
|--------|----------|
| 200 | `RunRecord` object |
| 404 | `{ error: "not found" }` |
| 409 | `{ error: "ambiguous prefix", candidates: [...] }` |

### `GET /api/runs/:id/events`

Returns parsed journal events for a run as `{ events: [...] }`. Events are read from the run's journal file (or the global journal as fallback). Unparseable lines are returned as `{ raw: line }`.

### `GET /api/presets`

Returns available presets as `{ presets: [{ name, description }, ...] }`.

### `POST /api/runs`

Starts a new loop by spawning a detached `autoloop run` child process.

Request body:

```json
{
  "prompt": "string (required, max 10000 chars)",
  "preset": "string (optional, must match a known preset)"
}
```

Response: `202 Accepted` with `{ status: "accepted", pid: number }`.

The spawned loop writes to the shared registry. The dashboard picks it up on the next poll cycle.

### `GET /healthz`

Returns `{ status: "ok" }`. Useful for readiness checks.

## Architecture

### Dependencies

| Package | Purpose |
|---------|---------|
| `hono` | HTTP framework (zero native deps) |
| `@hono/node-server` | Node.js HTTP adapter |
| Alpine.js 3.x (vendored) | Reactive SPA framework |

Alpine.js is served as a vendored static file — no npm frontend dependency, no build step.

### File layout

```
packages/
  cli/src/commands/
    dashboard.ts          # CLI dispatch, flag parsing, server bootstrap
  dashboard/src/
    app.ts                # Hono app factory, route mounting, origin check
    routes/
      api.ts              # JSON API routes
      pages.ts            # HTML page route, Alpine.js static serve
    views/
      shell.ts            # HTML shell template (inline CSS + JS)
      alpine-vendor.ts    # Vendored Alpine.js source
```

All HTML, CSS, and JavaScript are generated from TypeScript string templates — no template engine, no bundler, no file path resolution issues after compilation.

### Data flow

The dashboard is stateless. Each API request re-reads the registry and journal from disk:

```
Browser (Alpine.js)
  ├── GET /api/runs        → categorizeRuns(stateDir)
  ├── GET /api/runs/:id    → mergedFindRunByPrefix(stateDir, id)
  ├── GET /api/runs/:id/ev → readRunLines(journalPath, runId)
  ├── GET /api/presets     → listPresetsWithDescriptions(projectDir)
  └── POST /api/runs       → spawn("autoloop", ["run", ...])
```

### Security

- **Network**: binds `127.0.0.1` by default. Non-localhost `--host` enables `Origin` header validation on `/api/*` routes.
- **Injection**: `POST /api/runs` uses `spawn()` with array args — no shell interpolation. Prompt length is capped at 10,000 characters. Preset names are validated against the known preset list.
- **XSS**: Alpine.js `x-text` auto-escapes user data. Markdown rendering uses a built-in renderer for structured event fields.

## Non-goals

- Multi-user authentication or authorization.
- WebSocket/SSE live streaming (polling is sufficient).
- Stopping or killing runs from the UI (use `autoloop stop` via CLI).
- Frontend build toolchain.
- Daemon mode or background process management.
