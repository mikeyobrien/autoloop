# Task 1: Hono Server Bootstrap & CLI Wiring

**RFC:** `docs/rfcs/dashboard.md`
**Files to create:** `src/commands/dashboard.ts`, `src/dashboard/app.ts`
**Files to modify:** `src/main.ts`
**New dependencies:** `hono`, `@hono/node-server`
**Estimated scope:** ~80 lines added

## Objective

Add `autoloop dashboard` as a CLI command that starts a Hono HTTP server on localhost, blocks until Ctrl-C, and shuts down cleanly.

## Steps

### 1. Install dependencies

```bash
npm install hono @hono/node-server
```

### 2. Create `src/dashboard/app.ts` — Hono app factory

```typescript
import { Hono } from "hono";

export function createApp(): Hono {
  const app = new Hono();
  // Route mounting happens here in later tasks
  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}
```

### 3. Create `src/commands/dashboard.ts` — CLI dispatch

```typescript
import { serve } from "@hono/node-server";
import { createApp } from "../dashboard/app.js";

export function dispatchDashboard(
  args: string[],
  argv: string[],
  bundleRoot: string,
  selfCmd: string,
): void {
  const port = parseFlag(args, "--port", 4800);
  const host = parseFlag(args, "--host", "127.0.0.1");
  const projectDir = parseFlag(args, "--project-dir", process.env["AUTOLOOP_PROJECT_DIR"] || ".");

  const app = createApp();

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`Dashboard: http://${host}:${info.port}`);
  });

  const shutdown = () => { server.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

`parseFlag` is a local helper that reads `--flag value` pairs from the args array, returning the typed default if absent.

### 4. Wire into `src/main.ts`

Add import:
```typescript
import { dispatchDashboard } from "./commands/dashboard.js";
```

Add case in `dispatch()` switch before `default`:
```typescript
case "dashboard":
  dispatchDashboard(args.slice(1), argv, bundleRoot, selfCmd);
  return;
```

Add `"dashboard"` to the `isCliCommand()` list.

### 5. Handle `EADDRINUSE`

Wrap `serve()` in try/catch. On `EADDRINUSE`, print:
```
Port 4800 in use. Try: autoloop dashboard --port 4801
```

## Testing

- Start `autoloop dashboard`, verify `http://127.0.0.1:4800/healthz` returns `{"ok":true}`.
- Ctrl-C cleanly exits (exit code 0).
- `--port 5000` binds to port 5000.
- Port conflict prints a helpful error.
- `autoloop --help` still works (no regressions).

## Acceptance Criteria

- `autoloop dashboard` starts a Hono server and blocks.
- SIGINT/SIGTERM trigger graceful shutdown.
- `--port`, `--host`, `--project-dir` flags parsed correctly.
- No new dependencies beyond `hono` and `@hono/node-server`.
