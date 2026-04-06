# Task 2: API Routes

**RFC:** `docs/rfcs/dashboard.md`
**Files to create:** `src/dashboard/routes/api.ts`
**Files to modify:** `src/dashboard/app.ts`, `src/commands/dashboard.ts`
**Estimated scope:** ~120 lines added

## Objective

Implement the five JSON API routes that the SPA will consume. All routes reuse existing registry/journal/preset read functions — no new data model.

## Prerequisites

- Task 1 complete (Hono server running).

## Steps

### 1. Create `src/dashboard/routes/api.ts`

Export a function that mounts routes on a Hono app, accepting context (paths, selfCmd):

```typescript
import { Hono } from "hono";

export interface DashboardContext {
  registryPath: string;
  journalPath: string;
  bundleRoot: string;
  projectDir: string;
  selfCmd: string;
}

export function apiRoutes(ctx: DashboardContext): Hono {
  const api = new Hono();
  // ... routes below
  return api;
}
```

### 2. `GET /api/runs`

```typescript
import { categorizeRuns } from "../../loops/health.js";

api.get("/runs", (c) => {
  const result = categorizeRuns(ctx.registryPath);
  return c.json({ ...result, timestamp: new Date().toISOString() });
});
```

Reads registry from disk on every request — stateless, no cache.

### 3. `GET /api/runs/:id`

```typescript
import { findRunByPrefix } from "../../registry/read.js";

api.get("/runs/:id", (c) => {
  const result = findRunByPrefix(ctx.registryPath, c.req.param("id"));
  if (!result) return c.json({ error: "not found" }, 404);
  if (Array.isArray(result)) return c.json({ error: "ambiguous prefix", candidates: result.map(r => r.run_id) }, 409);
  return c.json(result);
});
```

### 4. `GET /api/runs/:id/events`

```typescript
import { readRunLines } from "../../harness/journal.js";

api.get("/runs/:id/events", (c) => {
  const lines = readRunLines(ctx.journalPath, c.req.param("id"));
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return c.json({ events });
});
```

Note: `readRunLines()` takes a journalPath and runId. The `:id` param here is a full run ID, not a prefix. If prefix lookup is desired, resolve via `findRunByPrefix` first — but for v1, use exact match to keep it simple.

### 5. `GET /api/presets`

```typescript
import { listPresetsWithDescriptions } from "../../chains/load.js";

api.get("/presets", (c) => {
  const presets = listPresetsWithDescriptions(ctx.bundleRoot);
  return c.json({ presets: presets.map(p => ({ name: p.name, description: p.description })) });
});
```

### 6. `POST /api/runs`

```typescript
import { spawn } from "node:child_process";

api.post("/runs", async (c) => {
  const body = await c.req.json<{ prompt: string; preset: string; backend?: string }>();
  if (!body.prompt?.trim() || !body.preset?.trim()) {
    return c.json({ error: "prompt and preset are required" }, 400);
  }

  const args = ["run", "-p", body.preset];
  if (body.backend) args.push("-b", body.backend);
  args.push(body.prompt);

  const child = spawn(ctx.selfCmd.replace(/'/g, ""), args, {
    cwd: ctx.projectDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return c.json({ message: "Loop started", pid: child.pid }, 202);
});
```

### 7. Mount in `app.ts`

```typescript
import { apiRoutes, DashboardContext } from "./routes/api.js";

export function createApp(ctx: DashboardContext): Hono {
  const app = new Hono();
  app.route("/api", apiRoutes(ctx));
  return app;
}
```

### 8. Pass context from `dashboard.ts`

Build `DashboardContext` in `dispatchDashboard()` using resolved paths:

```typescript
const registryPath = join(resolve(projectDir), ".autoloop", "registry.jsonl");
const journalPath = join(resolve(projectDir), ".autoloop", "journal.jsonl");
const ctx: DashboardContext = { registryPath, journalPath, bundleRoot, projectDir, selfCmd };
const app = createApp(ctx);
```

## Testing

- `GET /api/runs` returns JSON with `active`, `stuck`, `recent_failed`, `recent_completed`, `timestamp`.
- `GET /api/runs/:id` returns a run record or 404.
- `GET /api/runs/:id/events` returns `{ events: [...] }`.
- `GET /api/presets` returns preset list with names and descriptions.
- `POST /api/runs` with valid body returns 202 and spawns a detached process.
- `POST /api/runs` with missing prompt returns 400.

## Acceptance Criteria

- All 5 routes return correct JSON shapes matching the RFC.
- No new data model — reads existing registry/journal files.
- `POST /api/runs` uses `spawn()` with array args (no shell).
- Route errors return appropriate HTTP status codes (400, 404, 409).
