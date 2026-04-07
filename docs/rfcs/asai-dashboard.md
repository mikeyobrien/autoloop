# RFC: ASAI-Native Autoloop Dashboard Panel

**Slug:** `asai-dashboard`
**Status:** Draft
**Date:** 2026-04-06

## Summary

Replace the current Alpine.js/Hono SPA dashboard with a React component library (`@autoloop/dashboard-ui`) that AgentSpaces Desktop imports as a native panel. The Hono API server remains unchanged as the data backend. The React components consume the same JSON API endpoints through the Desktop's HTTP proxy layer, match the Desktop's visual language, and add keyboard navigation, command palette, toast notifications, and resizable panels.

## Motivation

The current dashboard (`src/dashboard/`) is a Hono server serving an Alpine.js SPA with vendored JavaScript. This works for standalone browser use but cannot be embedded inside AgentSpaces Desktop as a native panel because:

1. **No React interop** — Alpine.js manages its own DOM; it can't participate in React's component tree, context, or lifecycle.
2. **No TypeScript** — The Alpine.js code is untyped JavaScript in template strings, making it fragile to refactor and impossible to share types with the Desktop.
3. **No tree-shaking** — The entire SPA is a monolithic HTML string; individual components can't be imported.
4. **No keyboard/a11y** — Alpine.js lacks built-in focus management, ARIA patterns, and keyboard navigation that Radix UI provides.
5. **No Desktop integration** — The SPA uses raw `fetch()` and can't route through the Desktop's HTTP proxy layer.

A React component library solves all five issues while preserving the existing Hono API backend unchanged.

---

## Design

### Package Structure

```
packages/
  dashboard-ui/
    package.json              # @autoloop/dashboard-ui
    tsconfig.json             # React 18 + JSX transform
    tsup.config.ts            # Build: ESM + CJS + .d.ts
    src/
      index.ts                # Public API barrel export
      types.ts                # Shared types (RunRecord, HealthResult, etc.)
      context.ts              # DashboardProvider + useDashboard()
      hooks/
        use-runs.ts           # Polling hook for /api/runs
        use-run-detail.ts     # Single run fetch
        use-run-events.ts     # Events fetch for selected run
        use-presets.ts         # Presets fetch
        use-interval.ts       # Generic polling primitive
        use-keyboard.ts       # Keyboard shortcut registration
      components/
        loop-dashboard.tsx # Top-level composed component
        chat-box.tsx           # Preset select + prompt + start
        run-list.tsx           # Categorized run list with collapsible sections
        run-item.tsx           # Single run row
        run-detail.tsx         # Selected run metadata + event timeline
        event-timeline.tsx     # Scrollable event list
        event-item.tsx         # Single event with expandable detail
        command-palette.tsx    # cmdk integration
        status-badge.tsx       # cva-styled status indicator
        markdown.tsx           # Lightweight markdown renderer
      lib/
        event-helpers.ts       # Event classification, summary extraction
        time.ts                # timeAgo(), runDuration()
        prompt-parser.ts       # Structured prompt section parser
        cn.ts                  # clsx + tailwind-merge utility
```

### Public API

```typescript
// packages/dashboard-ui/src/index.ts
export { LoopDashboard } from "./components/loop-dashboard";
export { DashboardProvider, useDashboard } from "./context";
export type { DashboardConfig, Fetcher } from "./types";

// Individual components for advanced composition
export { ChatBox } from "./components/chat-box";
export { RunList } from "./components/run-list";
export { RunDetail } from "./components/run-detail";
export { EventTimeline } from "./components/event-timeline";
export { CommandPalette } from "./components/command-palette";
export { StatusBadge } from "./components/status-badge";
```

### Host Integration

AgentSpaces Desktop mounts the dashboard like this:

```tsx
import { LoopDashboard } from "@autoloop/dashboard-ui";

function AutoloopPanel() {
  return (
    <LoopDashboard
      fetcher={desktopHttpProxy.fetch}  // Desktop's proxy-aware fetch
      baseUrl="/autoloop"                // Proxy prefix
      pollIntervalMs={3000}
    />
  );
}
```

---

### Context & Data Layer

#### DashboardProvider

A single React context provides the fetcher, configuration, and shared state to all child components.

```typescript
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface DashboardConfig {
  fetcher: Fetcher;
  baseUrl?: string;        // Default: ""
  pollIntervalMs?: number; // Default: 3000
}

interface DashboardState {
  runs: HealthResult | null;
  selectedRunId: string | null;
  selectedRunDetail: RunRecord | null;
  selectedRunEvents: JournalEvent[];
  presets: PresetInfo[];
  lastUpdated: string | null;
  error: string | null;
}

type DashboardAction =
  | { type: "RUNS_LOADED"; payload: HealthResult }
  | { type: "RUN_SELECTED"; payload: string }
  | { type: "RUN_DETAIL_LOADED"; payload: RunRecord }
  | { type: "EVENTS_LOADED"; payload: JournalEvent[] }
  | { type: "PRESETS_LOADED"; payload: PresetInfo[] }
  | { type: "ERROR"; payload: string };
```

The provider wraps `useReducer(dashboardReducer, initialState)` and exposes both state and dispatch via context. Hooks like `useRuns()` consume the context internally.

#### Custom Hooks

| Hook | Endpoint | Behavior |
|------|----------|----------|
| `useRuns()` | `GET /api/runs` | Polls at `pollIntervalMs`. Returns `HealthResult`. Dispatches `RUNS_LOADED`. |
| `useRunDetail(id)` | `GET /api/runs/:id` | Fetches on `id` change. Returns `RunRecord \| null`. |
| `useRunEvents(id)` | `GET /api/runs/:id/events` | Fetches on `id` change + re-fetches each poll cycle. Returns `JournalEvent[]`. |
| `usePresets()` | `GET /api/presets` | Fetches once on mount. Returns `PresetInfo[]`. |

All hooks use the injected `fetcher` from context — never raw `fetch()`.

#### Polling → SSE Migration Path

The `useRuns` hook internally uses a `useInterval` primitive:

```typescript
function useInterval(callback: () => void, delayMs: number | null): void;
```

For future SSE support, the hook can be swapped to accept a `TransportFactory`:

```typescript
type TransportFactory = (url: string) => {
  subscribe(cb: (data: unknown) => void): void;
  close(): void;
};
```

This is a v2 concern — v1 uses polling only. The hook boundary is the migration seam.

---

### Component Design

#### `<LoopDashboard />`

Top-level composed component. Wraps everything in `DashboardProvider` and lays out the panel:

```
┌──────────────────────────────────────────────────────┐
│  autoloop dashboard                    [updated Xs]  │
├──────────────────────────────────────────────────────┤
│  ┌─ Left Panel (resizable) ──────────────────────┐   │
│  │  <ChatBox />                                  │   │
│  │  <RunList />                                  │   │
│  ├─ resize handle ───────────────────────────────┤   │
│  │  <RunDetail />                                │   │
│  │    <RunMetadata />                            │   │
│  │    <EventTimeline />                          │   │
│  └───────────────────────────────────────────────┘   │
│  <CommandPalette />  (overlay, Cmd+K)                │
│  <Toaster />         (sonner, bottom-right)          │
└──────────────────────────────────────────────────────┘
```

Uses `react-resizable-panels` for the vertical split between run list and detail pane. Default split: 40% list / 60% detail.

#### `<RunList />`

Maps `HealthResult` buckets to collapsible sections using Radix `Collapsible`:

```typescript
const categories = [
  { key: "active", label: "Active", items: runs.active },
  { key: "watching", label: "Watching", items: runs.watching },
  { key: "stuck", label: "Stuck", items: runs.stuck },
  { key: "recentFailed", label: "Failed", items: runs.recentFailed },
  { key: "recentCompleted", label: "Completed", items: runs.recentCompleted },
];
```

Auto-open logic: sections with items open by default (active, watching, stuck). User toggles are sticky via local state. Keyboard `↑`/`↓` navigates between run items across sections.

Each `<RunItem />` displays: `run_id[:16]` · preset · `iter N/M` · latest_event · timeAgo. Worktree runs show a `WT` badge (Lucide `GitBranch` icon). Merged runs show a `✓` indicator.

#### `<RunDetail />`

Displays metadata fields for the selected run:

| Field | Source |
|-------|--------|
| Status | `status` with `<StatusBadge />` |
| Preset | `preset` |
| Objective | `objective` (truncated with expand) |
| Iteration | `iteration / max_iterations` |
| Workspace | `worktree_name` or "shared checkout" |
| Created / Updated | `created_at`, `updated_at` with relative time |
| Duration | Computed from `created_at` → `updated_at` |
| Latest event | `[iter N] latest_event` |
| Merge info | Conditional block when `worktree_merged === true` |

#### `<EventTimeline />`

Scrollable list of `<EventItem />` components. Features:

- **Category coloring** via left border (same 6 categories as current SPA)
- **Backend event toggle** — checkbox filters `backend.*` events
- **Expandable detail** — click to expand event fields
- **Structured prompt rendering** — `iteration.start` events with `prompt` field get parsed into collapsible sections (objective, topology, scratchpad, memory, rules, config, harness)
- **Routing badges** — `suggested_roles`, `allowed_events`, `backpressure` rendered as colored badges
- **Markdown fields** — `backend.finish` output and `iteration.start` prompt rendered with `<Markdown />`

Event classification logic (from current SPA):

```typescript
function eventCategory(topic: string): EventCategory {
  if (["event.invalid", "wave.timeout", "wave.failed", "loop.stop"].includes(topic)) return "error";
  if (topic === "task.complete" || topic === "loop.complete") return "completion";
  if (topic.startsWith("review.")) return "review";
  if (topic.startsWith("backend.")) return "backend";
  if (topic.startsWith("iteration.")) return "system";
  return "coordination";
}
```

#### `<ChatBox />`

- Radix `Select` for preset dropdown (replaces `<select>`)
- `<textarea>` with auto-resize
- Start button + `Cmd+Enter` / `Ctrl+Enter` shortcut
- On submit: `POST /api/runs` via fetcher, clear prompt, show sonner toast "Loop started", trigger immediate poll refresh

#### `<CommandPalette />`

cmdk-based overlay triggered by `Cmd+K` / `Ctrl+K`:

- **Search runs** — fuzzy match on `run_id`, `preset`, `objective`
- **Quick actions** — "Start new loop", "Refresh", "Toggle backend events"
- **Category jump** — "Show active", "Show stuck", etc.

#### `<StatusBadge />`

cva-styled badge with semantic colors:

```typescript
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        active: "bg-blue-600/20 text-blue-400",
        watching: "bg-amber-600/20 text-amber-400",
        stuck: "bg-red-600/20 text-red-400",
        failed: "bg-red-600/20 text-red-400",
        completed: "bg-green-600/20 text-green-400",
        stopped: "bg-zinc-600/20 text-zinc-400",
        timed_out: "bg-red-600/20 text-red-400",
      },
    },
  }
);
```

#### `<Markdown />`

Lightweight markdown renderer for event fields. Supports: headings, bold, italic, inline code, fenced code blocks, unordered/ordered lists. Uses `dangerouslySetInnerHTML` with HTML-escaped input (same approach as current SPA). No external markdown library — keeps bundle small.

---

### Toast Notifications

sonner toasts fire on run state transitions detected during polling:

| Transition | Toast |
|------------|-------|
| New run appears in `active` | "Loop started: {preset} — {run_id[:8]}" |
| Run moves to `stuck` | "⚠️ Run stuck: {run_id[:8]}" (warning style) |
| Run moves to `completed` | "✓ Run completed: {run_id[:8]}" (success style) |
| Run moves to `failed` | "✗ Run failed: {run_id[:8]}" (error style) |

Detection: compare previous `HealthResult` run IDs against current. New IDs in a bucket = transition.

---

### Keyboard Navigation

Implemented via `useKeyboard` hook that registers global `keydown` listeners:

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Cmd+K` / `Ctrl+K` | Toggle command palette | Global |
| `↑` / `↓` | Navigate run list | When run list focused |
| `Enter` | Select highlighted run | When run list focused |
| `Escape` | Close detail / palette | Global |
| `Cmd+Enter` / `Ctrl+Enter` | Submit chatbox | When chatbox focused |

Focus management: clicking a run item focuses the detail pane. `Escape` returns focus to the run list.

---

### Build & Packaging

```
packages/dashboard-ui/
  package.json
  tsconfig.json
  tsup.config.ts
```

**package.json** (key fields):

```json
{
  "name": "@autoloop/dashboard-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
    "./styles.css": "./dist/styles.css"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "dependencies": {
    "@radix-ui/react-collapsible": "^1.0.0",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tooltip": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "cmdk": "^1.0.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.400.0",
    "react-resizable-panels": "^2.0.0",
    "sonner": "^1.5.0",
    "tailwind-merge": "^2.0.0"
  }
}
```

**tsup.config.ts**:

```typescript
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  external: ["react", "react-dom"],
  sourcemap: true,
});
```

The host (AgentSpaces Desktop) provides React, ReactDOM, and Tailwind CSS. The library ships its own Tailwind utility classes via a `styles.css` export that the host includes.

---

## Non-Goals

- **No changes to the Hono API server** — routes, response shapes, and server lifecycle are unchanged.
- **No multi-user auth** — single operator, same as current.
- **No SSE/WebSocket implementation** — v1 uses polling; hook boundary supports future transport swap.
- **No stopping/killing loops** — read-only + start-only, same as current.
- **No daemon mode** — the Hono server still runs as a foreground CLI process.
- **No removal of the Alpine.js SPA** — it continues to work for standalone browser use. The React library is an alternative consumer of the same API.

## Alternatives Considered

| Approach | Verdict | Reason |
|----------|---------|--------|
| Upgrade Alpine.js in-place | Reject | Can't embed in React host; no TypeScript; no tree-shaking |
| Web Components wrapper | Reject | Shadow DOM breaks Tailwind; poor React context interop |
| iframe embed | Reject | Breaks Desktop theme, keyboard, and proxy integration |
| Preact | Reject | Desktop uses React 18; adding Preact is unnecessary divergence |
| SWR/TanStack Query | Defer | Good polling abstraction but adds dependency; custom hooks suffice for v1 |
| Zustand/Jotai | Reject | Context + useReducer is sufficient for this scope |

## Migration & Compatibility

- The Alpine.js SPA (`src/dashboard/`) is **not removed**. It continues to serve standalone browser users via `autoloop dashboard`.
- The React library is a **new, parallel consumer** of the same Hono API.
- AgentSpaces Desktop imports `@autoloop/dashboard-ui` and mounts it in a panel.
- Both consumers can run simultaneously against the same Hono backend.
- Future: once Desktop adoption is confirmed, the Alpine.js SPA can be deprecated.

## Open Questions

None — all design decisions resolved during research phase.
