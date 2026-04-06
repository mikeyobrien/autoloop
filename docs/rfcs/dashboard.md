# RFC: Operator Dashboard (`autoloop dashboard`)

**Slug:** `dashboard`
**Status:** Draft
**Date:** 2026-04-04

## Summary

Add an `autoloop dashboard` command that launches a lightweight Hono HTTP server serving an Alpine.js SPA. The dashboard gives operators a browser-based view of active and recent loops with a chat box to start new ones — all backed by the existing registry/journal data model with no new storage.

## Motivation

Operators currently monitor loops via `autoloop loops`, `autoloop inspect`, and `autoloop loops watch`. These work well for single-run focus but fall short when juggling multiple concurrent loops or when a non-CLI user needs visibility. A minimal web dashboard bridges this gap without compromising the project's zero-dependency philosophy.

---

## Design

### Command Shape

```
autoloop dashboard [--port <n>] [--host <addr>] [--project-dir <path>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `4800` | HTTP listen port |
| `--host` | `127.0.0.1` | Bind address (localhost only by default) |
| `--project-dir` | `AUTOLOOP_PROJECT_DIR` or `.` | Project root for registry/journal resolution |

The command blocks (like `loops watch`) — Ctrl-C stops the server.

### Implementation Entry Point

```typescript
// src/commands/dashboard.ts
export function dispatchDashboard(
  args: string[],
  argv: string[],
  bundleRoot: string,
  selfCmd: string,
): boolean;
```

Registered in `src/main.ts` switch:

```typescript
case "dashboard":
  return dispatchDashboard(args.slice(1), argv, bundleRoot, selfCmd);
```

---

### Server Lifecycle

```
┌─────────────────────────────────────────┐
│  dispatchDashboard()                    │
│  1. Parse flags (port, host, projectDir)│
│  2. Resolve registryPath, journalPath   │
│  3. Create Hono app, mount routes       │
│  4. Start @hono/node-server             │
│  5. Print "Dashboard: http://host:port" │
│  6. Register SIGINT/SIGTERM → close()   │
└─────────────────────────────────────────┘
```

- Server runs in the foreground CLI process.
- No daemon mode in v1 — operator keeps the terminal open.
- Graceful shutdown: close the HTTP server, then `process.exit(0)`.
- Port conflict: catch `EADDRINUSE`, print a clear error with `--port` hint.

### Dependencies

| Package | Type | Size | Purpose |
|---------|------|------|---------|
| `hono` | prod | ~30 KB | HTTP framework (zero native deps) |
| `@hono/node-server` | prod | ~5 KB | Node.js HTTP adapter for Hono |
| Alpine.js 3.x | vendored | ~15 KB | Reactive SPA framework (no npm dep) |

Total new npm deps: **2**. Alpine.js is vendored as a static file at `src/dashboard/static/alpine.min.js`.

---

### File Layout

```
src/
  commands/
    dashboard.ts          # CLI dispatch, flag parsing, server bootstrap
  dashboard/
    app.ts                # Hono app factory, route mounting
    routes/
      api.ts              # JSON API routes
      pages.ts            # HTML page routes (serves index.html shell)
    static/
      alpine.min.js       # Vendored Alpine.js
      style.css           # Minimal CSS (no build step)
    views/
      shell.ts            # HTML shell template (string literal)
      components.ts       # Alpine.js component templates (string literals)
```

All HTML is generated from TypeScript string templates — no template engine dependency, no build step.

---

### API Routes

All routes under `/api/` return JSON. The SPA fetches these via polling.

#### `GET /api/runs`

Returns all runs, categorized by health status.

```typescript
// Uses existing categorizeRuns() from src/loops/health.ts
interface RunsResponse {
  active: RunRecord[];
  stuck: RunRecord[];
  recent_failed: RunRecord[];
  recent_completed: RunRecord[];
  timestamp: string; // ISO 8601 — client uses for staleness detection
}
```

#### `GET /api/runs/:id`

Returns a single run by ID or prefix match.

```typescript
// Uses findRunByPrefix() from src/registry/read.ts
// 200 → RunRecord
// 404 → { error: "not found" }
// 409 → { error: "ambiguous prefix", candidates: string[] }
```

#### `GET /api/runs/:id/events`

Returns journal events for a run.

```typescript
// Uses readRunLines() from src/harness/journal.ts
// Returns parsed JSON lines as an array
// 200 → { events: JournalEvent[] }
```

#### `GET /api/presets`

Returns available presets for the start-loop dropdown.

```typescript
// Uses listPresetsWithDescriptions() from src/chains.ts
interface PresetsResponse {
  presets: { name: string; description: string }[];
}
```

#### `POST /api/runs`

Starts a new loop. Spawns a detached child process.

```typescript
interface StartRunRequest {
  prompt: string;          // Required — from chat box
  preset: string;          // Required — from dropdown
  backend?: string;        // Optional override
}

// Response: 202 Accepted
interface StartRunResponse {
  run_id: string;          // Extracted from spawned process stdout or registry poll
  message: string;
}
```

Implementation:

```typescript
import { spawn } from "node:child_process";

function startRun(selfCmd: string, req: StartRunRequest, projectDir: string): void {
  const args = ["run", "-p", req.preset];
  if (req.backend) args.push("-b", req.backend);
  args.push(req.prompt);

  const child = spawn(selfCmd, args, {
    cwd: projectDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref(); // Dashboard process doesn't wait for the loop
}
```

The spawned loop writes to the shared registry. The dashboard's next poll cycle picks it up.

---

### SPA Layout

Single-page app with three zones. No routing library — Alpine.js `x-show` toggles visibility.

```
┌──────────────────────────────────────────────────────┐
│  autoloop dashboard                          [port]  │  <- header
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐  │
│  │  [preset ▾]  [Enter a prompt to start a loop…] │  │  <- chat box
│  │                                        [Start] │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Active (2)           Stuck (0)                      │  <- status badges
│  ┌────────────────────────────────────────────────┐  │
│  │ abc12345  autocode  iter:3  design.ready  12s  │  │  <- run list
│  │ def67890  autospec  iter:1  brief.ready   45s  │  │
│  │ ghi11111  autocode  completed  5m ago          │  │
│  │ ...                                            │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│  Run Detail: abc12345                                │  <- detail pane
│  Status: running   Preset: autocode   Iter: 3       │
│  Objective: Implement dashboard RFC                  │
│  Latest: design.ready                                │
│  ┌─ Events ───────────────────────────────────────┐  │
│  │ loop.start          iter:1  ...                │  │
│  │ iteration.start     iter:1  ...                │  │
│  │ brief.ready         iter:1  ...                │  │
│  │ ...                                            │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Alpine.js Data Model

```html
<div x-data="dashboard()" x-init="startPolling()">
```

```javascript
function dashboard() {
  return {
    runs: { active: [], stuck: [], recent_failed: [], recent_completed: [] },
    presets: [],
    selectedRun: null,
    selectedRunEvents: [],
    newPrompt: "",
    selectedPreset: "",
    pollInterval: null,

    async startPolling() {
      await this.fetchPresets();
      await this.fetchRuns();
      this.pollInterval = setInterval(() => this.fetchRuns(), 3000);
    },

    async fetchRuns() {
      const res = await fetch("/api/runs");
      this.runs = await res.json();
    },

    async fetchPresets() {
      const res = await fetch("/api/presets");
      const data = await res.json();
      this.presets = data.presets;
      if (this.presets.length && !this.selectedPreset) {
        this.selectedPreset = this.presets[0].name;
      }
    },

    async selectRun(runId) {
      this.selectedRun = runId;
      const res = await fetch(`/api/runs/${runId}/events`);
      const data = await res.json();
      this.selectedRunEvents = data.events;
    },

    async startLoop() {
      if (!this.newPrompt.trim()) return;
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: this.newPrompt,
          preset: this.selectedPreset,
        }),
      });
      this.newPrompt = "";
    },
  };
}
```

### Live Update Strategy

**Polling at 3-second intervals** via `setInterval` + `fetch("/api/runs")`.

- Matches the existing `watchRun` pattern (2s polling in CLI).
- Server re-reads registry from disk on each request — stateless, no caching.
- Detail pane events refresh when a run is selected or re-selected.
- No SSE/WebSocket in v1. API shape supports future `GET /api/runs/stream` addition.

### CSS Strategy

Minimal, classless CSS in `style.css`:

- System font stack, monospace for data.
- CSS grid for layout zones (header, chat, list, detail).
- Status-colored badges via `data-status` attribute selectors.
- Dark mode via `prefers-color-scheme` media query.
- No CSS framework, no build step. ~100 lines.

---

### Security & Safety

| Concern | Mitigation |
|---------|------------|
| Network exposure | Bind `127.0.0.1` by default. `--host 0.0.0.0` requires explicit opt-in. |
| Command injection via prompt | `spawn()` with array args — no shell interpolation. |
| XSS in run data | Alpine.js `x-text` auto-escapes. No `x-html` or `innerHTML`. |
| CSRF on POST /api/runs | Localhost-only binding. Add `Origin` header check if `--host 0.0.0.0`. |
| DoS via rapid polling | Client-side only; server is stateless. Rate-limit not needed for single-user. |
| Stale data | `timestamp` field in API response; client can show "last updated X ago". |

### Portability

- macOS + Linux: Node.js `http.createServer` (via `@hono/node-server`).
- No native modules, no platform-specific code.
- Vendored Alpine.js works offline/airgapped.
- Static assets served inline from TypeScript string templates — no file path resolution issues after `tsc` compilation.

---

## Non-Goals

- **Multi-user / auth** — single operator, localhost only.
- **Log viewer** — no streaming of backend stdout/stderr.
- **WebSocket / SSE** — polling is sufficient for v1.
- **Frontend build step** — no bundler, no transpiler, no npm frontend deps.
- **Persistent dashboard state** — no database, no sessions, no cookies.
- **Daemon mode** — no background process management in v1.
- **Stopping/killing loops from the UI** — read-only + start-only in v1. Kill via CLI.

## Alternatives Considered

| Approach | Verdict | Reason |
|----------|---------|--------|
| Express | Reject | 50+ transitive deps |
| HTMX | Reject | Requires server-side rendering per interaction |
| React/Vite | Reject | Build toolchain, large dep tree |
| WebSocket updates | Reject for v1 | Connection management complexity, no precedent |
| Embed server in harness | Reject | Harness owns process lifecycle (stdio, signals) |
| TUI dashboard (blessed/ink) | Reject | Heavy deps, less accessible than a browser |

## Migration & Compatibility

- No changes to existing commands, registry format, or journal format.
- Dashboard reads the same files as `autoloop loops` — no new data model.
- `POST /api/runs` spawns the same `autoloop run` command an operator would type.
- Dashboard is additive — can be removed without affecting any other functionality.

## Open Questions

None — all questions resolved during research phase.
