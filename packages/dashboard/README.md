# @mobrienv/autoloop-dashboard

Hono-based read-only dashboard for autoloop runs.

Exposes a single `createApp(ctx)` that returns a `Hono` instance serving:
- `/healthz`
- `/api/runs`, `/api/runs/:id`, `/api/runs/:id/events`
- `/api/presets`
- HTML shell + Alpine.js vendor bundle under `/`

The dashboard is read-only — it reads the registry, journal, and worktree
metadata on disk and never mutates state.

## DashboardContext

```ts
interface DashboardContext {
  registryPath: string;
  journalPath: string;
  stateDir: string;
  bundleRoot: string;
  projectDir: string;
  selfCmd: string;
  host?: string;
  port?: number;
  /**
   * Inject the CLI's preset list. Keeps the dashboard independent of the
   * CLI's chains/ module while still serving `/api/presets`. Return `[]`
   * if presets aren't known in this context.
   */
  listPresets: (projectDir: string) => PresetInfo[];
}
```

Run classification (`active` / `watching` / `stuck`) is provided by
`@mobrienv/autoloop-core/runs-health::categorizeRuns` directly — no
injection needed there.

## Usage

```ts
import { createApp } from "@mobrienv/autoloop-dashboard";
import { serve } from "@hono/node-server";

const app = createApp({
  registryPath: "/path/to/.autoloop/registry.jsonl",
  journalPath: "/path/to/.autoloop/journal.jsonl",
  stateDir: "/path/to/.autoloop",
  bundleRoot: "/path/to/bundle",
  projectDir: "/path/to/project",
  selfCmd: "autoloop",
  listPresets: () => [],
});

serve({ fetch: app.fetch, port: 4800 });
```
