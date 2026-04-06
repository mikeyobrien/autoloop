# Task 5: Security Hardening & Polish

**RFC:** `docs/rfcs/dashboard.md`
**Files to modify:** `src/dashboard/app.ts`, `src/dashboard/routes/api.ts`, `src/commands/dashboard.ts`
**Estimated scope:** ~40 lines added

## Objective

Add the security boundaries defined in the RFC and polish the operator experience (startup message, error handling, graceful edge cases).

## Prerequisites

- Tasks 1-4 complete (fully functional dashboard).

## Steps

### 1. Origin check for `--host 0.0.0.0`

When the dashboard is bound to `0.0.0.0` (non-localhost), add Hono middleware that checks the `Origin` header on mutating requests:

```typescript
// In app.ts, applied conditionally
if (host !== "127.0.0.1" && host !== "localhost") {
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      const allowed = [`http://${host}:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`];
      if (origin && !allowed.includes(origin)) {
        return c.json({ error: "origin not allowed" }, 403);
      }
    }
    await next();
  });
}
```

Print a warning when `--host 0.0.0.0` is used:

```
Warning: Dashboard bound to 0.0.0.0 — accessible from the network. Use --host 127.0.0.1 for localhost-only.
```

### 2. Input validation on POST /api/runs

Already handled in Task 2 (400 on missing prompt/preset). Add:

- Trim prompt and preset before use.
- Reject prompts longer than 10,000 characters (sanity limit).
- Validate preset exists in the preset list before spawning.

```typescript
const presets = listPresetsWithDescriptions(ctx.bundleRoot);
if (!presets.some(p => p.name === body.preset)) {
  return c.json({ error: `unknown preset: ${body.preset}` }, 400);
}
```

### 3. Content-Type headers on static assets

Ensure `alpine.min.js` is served with `Content-Type: application/javascript` and `style.css` with `Content-Type: text/css`. If using manual file serving, set headers explicitly.

### 4. Startup banner

Print a clear startup message:

```
autoloop dashboard
  URL:     http://127.0.0.1:4800
  Project: /path/to/project
  Press Ctrl-C to stop
```

### 5. Handle missing registry/journal gracefully

If `registry.jsonl` or `journal.jsonl` doesn't exist yet (fresh project), API routes should return empty results rather than crashing:

- `GET /api/runs` → `{ active: [], stuck: [], recent_failed: [], recent_completed: [], timestamp: "..." }`
- `GET /api/runs/:id/events` → `{ events: [] }`

Verify that `categorizeRuns()` and `readRunLines()` handle missing files — if they throw, add guards in the route handlers.

### 6. 404 fallback

Add a catch-all route that returns the SPA shell for any non-API path (SPA-style routing support for future use):

```typescript
app.get("*", (c) => c.html(htmlShell()));
```

Or, more conservatively, return a plain 404 for unknown paths in v1.

## Testing

- `POST /api/runs` with `--host 0.0.0.0` and wrong Origin header returns 403.
- `POST /api/runs` with non-existent preset returns 400.
- `POST /api/runs` with empty prompt returns 400.
- Dashboard starts cleanly on a fresh project with no registry file.
- Static assets served with correct Content-Type headers.
- Startup banner printed to stdout.

## Acceptance Criteria

- Origin check active when bound to non-localhost.
- Warning printed for non-localhost binding.
- Preset validated before spawning.
- Missing registry/journal handled gracefully.
- Static assets have correct MIME types.
