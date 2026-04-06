# Task 3: SPA Shell, Static Assets & Page Route

**RFC:** `docs/rfcs/dashboard.md`
**Files to create:** `src/dashboard/views/shell.ts`, `src/dashboard/static/style.css`, `src/dashboard/routes/pages.ts`
**Files to modify:** `src/dashboard/app.ts`
**Estimated scope:** ~150 lines added

## Objective

Serve the HTML shell, vendored Alpine.js, and CSS so the browser loads a functional (but empty) SPA scaffold. After this task, navigating to `http://localhost:4800/` renders the layout with header, chat box placeholder, run list placeholder, and detail pane placeholder.

## Prerequisites

- Task 1 complete (server running).

## Steps

### 1. Vendor Alpine.js

Download Alpine.js 3.x minified into `src/dashboard/static/alpine.min.js`:

```bash
curl -o src/dashboard/static/alpine.min.js https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js
```

Alternatively, copy from a known-good version pinned in the RFC. The file is ~15 KB.

**Important:** This is a static file committed to the repo — no npm dependency, no CDN at runtime.

### 2. Create `src/dashboard/views/shell.ts`

Export an `htmlShell()` function returning the full HTML page as a string:

```typescript
export function htmlShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>autoloop dashboard</title>
  <link rel="stylesheet" href="/static/style.css">
  <script defer src="/static/alpine.min.js"></script>
</head>
<body>
  <div x-data="dashboard()" x-init="startPolling()">
    <header>
      <h1>autoloop dashboard</h1>
    </header>

    <section id="chatbox">
      <!-- Task 4 fills this in -->
      <p>Chat box placeholder</p>
    </section>

    <section id="runlist">
      <!-- Task 4 fills this in -->
      <p>Run list placeholder</p>
    </section>

    <section id="detail">
      <!-- Task 4 fills this in -->
      <p>Detail pane placeholder</p>
    </section>
  </div>

  <script>
    function dashboard() {
      return {
        runs: { active: [], stuck: [], recent_failed: [], recent_completed: [] },
        presets: [],
        selectedRun: null,
        selectedRunEvents: [],
        newPrompt: "",
        selectedPreset: "",
        pollInterval: null,
        startPolling() {},
      };
    }
  </script>
</body>
</html>`;
}
```

Placeholders are replaced in Task 4. The `dashboard()` function stub ensures Alpine.js doesn't error.

### 3. Create `src/dashboard/static/style.css`

Minimal classless CSS (~100 lines):

- System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace`).
- Monospace for data elements (`pre`, `code`, `[data-mono]`).
- CSS grid for the four layout zones: `header`, `#chatbox`, `#runlist`, `#detail`.
- Status-colored badges via `[data-status="active"]`, `[data-status="stuck"]`, etc.
- Dark mode via `@media (prefers-color-scheme: dark)`.
- Max-width container (~900px) centered.
- No CSS framework. Keep under 120 lines.

### 4. Create `src/dashboard/routes/pages.ts`

```typescript
import { Hono } from "hono";
import { htmlShell } from "../views/shell.js";

export function pageRoutes(): Hono {
  const pages = new Hono();

  pages.get("/", (c) => c.html(htmlShell()));

  return pages;
}
```

### 5. Serve static files from `src/dashboard/static/`

Use Hono's `serveStatic` middleware or manually serve from the filesystem. Since files are small and few, inlining them as string constants is also acceptable for portability after `tsc` compilation.

**Recommended approach:** Read the static files at startup and serve from memory:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

// In app.ts or a static route file:
app.get("/static/:file", (c) => {
  const file = c.req.param("file");
  const staticDir = join(import.meta.dirname, "static");
  // Serve with appropriate content-type
});
```

Alternatively, embed the CSS as a string constant in `shell.ts` via a `<style>` tag, and Alpine.js as an inline script. This avoids file-path resolution issues after compilation but makes the files harder to edit.

**Decision:** Use file-serving for development ergonomics. The static directory path should be resolved relative to the compiled JS output. Pass `staticDir` as part of the app context.

### 6. Mount in `app.ts`

```typescript
import { pageRoutes } from "./routes/pages.js";

// In createApp():
app.route("/", pageRoutes());
```

## Testing

- `GET /` returns HTML with `<!DOCTYPE html>`, Alpine.js script tag, and CSS link.
- `GET /static/alpine.min.js` returns JavaScript with correct `Content-Type`.
- `GET /static/style.css` returns CSS with correct `Content-Type`.
- Page renders in a browser with visible layout zones (even if empty).

## Acceptance Criteria

- Browser loads the SPA shell at `http://localhost:4800/`.
- Alpine.js initializes without console errors.
- CSS grid layout visible with four distinct zones.
- Dark mode works via system preference.
- No frontend build step — all assets are static files or string templates.
- Alpine.js is vendored (no CDN fetch at runtime).
