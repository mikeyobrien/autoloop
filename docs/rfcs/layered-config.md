# RFC: Layered Configuration (Global / User / Package)

**Slug:** `layered-config`
**Status:** Draft
**Date:** 2026-04-04

## Summary

Add support for user-level configuration that merges with project-level `autoloops.toml` using well-defined precedence rules. This lets users set default backends, timeouts, and preferences once, while project configs retain full override authority.

## Motivation

Today autoloop config is flat: `defaults()` deep-merged with a single `autoloops.toml`. Users who work across multiple presets must either:
- Rely on the fragile cwd-based `applyGlobalBackendOverride()` hack
- Pass `-b`/`-v` flags every invocation
- Duplicate backend settings in every project's `autoloops.toml`

A user-level config file eliminates this friction.

---

## Design

### Precedence (highest wins)

```
CLI flags / backendOverride    ← highest
  ↑
AUTOLOOP_CONFIG env file       ← replaces user layer path
  ↑
project  (./autoloops.toml)    ← versioned intent
  ↑
user     (~/.config/autoloop/config.toml)  ← ambient preferences
  ↑
defaults()                     ← hardcoded fallbacks
```

**Rule:** project config overrides user config. CLI overrides everything. This matches the git model: project config is intentional and versioned; user config is ambient preference; CLI is an explicit force.

### File Locations

| Layer | Path | Overridable by |
|-------|------|----------------|
| User | `$XDG_CONFIG_HOME/autoloop/config.toml` (default: `~/.config/autoloop/config.toml`) | `AUTOLOOP_CONFIG` env var |
| Project | `./autoloops.toml` (or `./autoloops.conf`) | — |

**Platform notes:**
- Linux: `$XDG_CONFIG_HOME` respected, defaults to `~/.config`
- macOS: `~/.config/autoloop/config.toml` (CLI convention)
- Windows: `%APPDATA%\autoloop\config.toml`

Resolution function:

```typescript
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function resolveUserConfigPath(): string | null {
  // Env override replaces the entire user layer path
  const envPath = process.env.AUTOLOOP_CONFIG;
  if (envPath) return envPath;

  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "autoloop", "config.toml");
  }

  // XDG on Linux/macOS, falls back to ~/.config
  const xdgHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgHome, "autoloop", "config.toml");
}
```

**No system/global layer for v1.** System-wide config (`/etc/autoloop/`) adds permissions complexity with near-zero user demand. Can be inserted between defaults and user later without breaking changes.

### Merge Semantics

The existing `deepMerge()` function handles all merge cases correctly:

| Type | Behavior | Example |
|------|----------|---------|
| Object/section | Recursive merge | `[backend]` in user merged with `[backend]` in project |
| Scalar | Last-writer-wins | `backend.command = "pi"` in user, `"claude"` in project → `"claude"` |
| Array (stringified) | Last-writer-wins | `backend.args` in project replaces user's entirely |

**Resolution chain:**

```typescript
export function loadLayered(projectDir: string): Config {
  const user = loadUserConfig();          // {} if file absent
  const project = loadProjectFile(projectDir); // {} if file absent
  return deepMerge(defaults(), deepMerge(user, project));
}
```

This is a single additional `deepMerge` call over today's `deepMerge(defaults(), projectFile)`.

### Unsetting Inherited Values

To unset a key inherited from a lower layer, set it to empty string:

```toml
# User config sets backend.prompt_mode = "markdown"
# Project wants to unset it (use default behavior)
[backend]
prompt_mode = ""
```

Empty string is already the "not set" sentinel in the accessor functions (`get()` returns fallback when value is `""`). No new mechanism needed.

### User Config File Format

Identical to `autoloops.toml` — same TOML schema, same sections, same keys. Any key valid in a project config is valid in user config.

**Example `~/.config/autoloop/config.toml`:**

```toml
[backend]
kind = "claude"
command = "claude"
timeout_ms = 600000

[core]
log_level = "info"

[memory]
prompt_budget_chars = 12000
```

**What should NOT be in user config:**
- `event_loop.*` settings (completion events, required events) — these are inherently per-project
- Absolute paths that vary per-project (`core.journal_file`, etc.)
- API keys or secrets (use env vars or credential managers)

These aren't enforced, just documented. A user who puts `event_loop.max_iterations = 10` in their user config gets that as a default for all projects, overridden by any project that sets it explicitly.

### Impact on Existing Code

#### `config.ts` changes

```typescript
// NEW: resolve user config path
export function resolveUserConfigPath(): string | null { /* see above */ }

// NEW: load user config (returns empty config if absent)
export function loadUserConfig(): Config {
  const path = resolveUserConfigPath();
  if (!path || !existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}

// MODIFIED: loadProject becomes layered
export function loadProject(projectDir: string): Config {
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectFile(projectDir);
  return deepMerge(defaults(), deepMerge(userConfig, projectConfig));
}

// NEW: extracted from old loadProject
function loadProjectFile(projectDir: string): Config {
  const path = resolveConfigPath(projectDir);
  if (!existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}
```

**Key detail:** `loadProjectFile()` returns raw parsed TOML (stringified but NOT merged with defaults). Defaults are applied once at the end of `loadProject()`, not per-layer.

#### `commands/run.ts` changes

`applyGlobalBackendOverride()` continues to work but is **deprecated**. Once a user has `~/.config/autoloop/config.toml`, the cwd-based override is redundant:

```typescript
function applyGlobalBackendOverride(options: RunOptions): RunOptions {
  // EXISTING: cwd-based override — deprecated but functional
  // User config now handles this case natively via loadLayered()
  // Deprecation warning emitted if cwd override is active AND user config exists
  ...
}
```

The deprecation is soft: emit a one-time log message suggesting migration. Remove in v1.0.

#### Hot-reload

`reloadLoop()` in `harness/config-helpers.ts` calls `config.loadProject()` every iteration. Since `loadProject()` now calls `loadUserConfig()` internally, user config changes are picked up automatically. Cost: one additional `readFileSync` + TOML parse per iteration — negligible.

#### Everything that doesn't change

- `Config` type (`Record<string, unknown>`)
- `get()`, `put()`, `getInt()`, `getList()` accessors
- `stringifyValues()`, `deepMerge()` functions
- `backendOverrideFromProject()` (still used by cwd override, deprecated)
- TOML parser dependency
- CLI override via `backendOverride` in `RunOptions`
- `buildLoopContext()` — consumes `loadProject()` output, unchanged

### Provenance Introspection: `autoloop config show`

New subcommand to debug resolved config:

```
$ autoloop config show
# Resolved configuration (highest-precedence source shown)

[backend]
kind = "claude"                  # user (~/.config/autoloop/config.toml)
command = "claude"               # user (~/.config/autoloop/config.toml)
timeout_ms = "300000"            # project (./autoloops.toml)

[event_loop]
max_iterations = "5"             # project (./autoloops.toml)
completion_promise = "LOOP_COMPLETE"  # default
...
```

Implementation approach:

```typescript
type Provenance = Record<string, string>; // dot-path → source label

export function loadProjectWithProvenance(projectDir: string): {
  config: Config;
  provenance: Provenance;
} {
  const sources: Array<{ config: Config; label: string }> = [
    { config: defaults(), label: "default" },
    { config: loadUserConfig(), label: `user (${resolveUserConfigPath()})` },
    { config: loadProjectFile(projectDir), label: `project (${resolveConfigPath(projectDir)})` },
  ];

  let merged: Config = {};
  const provenance: Provenance = {};

  for (const { config: layer, label } of sources) {
    merged = deepMerge(merged, layer);
    recordProvenance(layer, label, provenance, "");
  }

  return { config: merged, provenance };
}

function recordProvenance(
  obj: Config, label: string, out: Provenance, prefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      recordProvenance(value as Config, label, out, path);
    } else {
      out[path] = label;
    }
  }
}
```

The `config show` command is **not in the hot path** — it's a diagnostic tool. The per-iteration `loadProject()` does not track provenance.

### CLI: `autoloop config` subcommands

| Command | Description |
|---------|-------------|
| `autoloop config show` | Display resolved config with provenance annotations |
| `autoloop config show --json` | Machine-readable JSON output with provenance |
| `autoloop config path` | Print the resolved user config path |

`autoloop config init` is deferred — the format is simple enough to create manually, and scaffolding adds maintenance burden.

### Repo Hygiene

| File | Commit? | Rationale |
|------|---------|-----------|
| `autoloops.toml` | Yes | Project-level config, defines loop behavior |
| `~/.config/autoloop/config.toml` | N/A | Outside repo |
| `.autoloop/` | No (already gitignored) | Runtime state |

**For published presets:** use bare command names (`command = "claude"`), never absolute paths. The user layer handles path resolution via `PATH` or explicit user config.

### Migration

#### Backward compatibility

- Existing `autoloops.toml` works identically — it's the project layer
- No existing config files need modification
- `applyGlobalBackendOverride()` continues working (deprecated)

#### Migration for cwd-based override users

**Before:**
```
# User has autoloops.toml in ~/projects/ with backend overrides
cd ~/projects && autoloop run autospec "do the thing"
```

**After:**
```
# Move backend settings to user config
mkdir -p ~/.config/autoloop
cat > ~/.config/autoloop/config.toml << 'EOF'
[backend]
kind = "claude"
command = "claude"
EOF

# Now works from any directory
autoloop run autospec "do the thing"
```

#### `AUTOLOOP_CONFIG` env var

Replaces the user config path entirely (like `GIT_CONFIG_GLOBAL`):

```bash
# CI: use a specific config
AUTOLOOP_CONFIG=/etc/ci/autoloop.toml autoloop run autospec "build it"

# Testing: use a temporary config
AUTOLOOP_CONFIG=/tmp/test-config.toml autoloop run autospec "test it"
```

### Precedence Examples

**Scenario 1: User sets default backend, project overrides**
```
User config:    backend.command = "pi"
Project config: backend.command = "claude"
Resolved:       backend.command = "claude"  ← project wins
```

**Scenario 2: User sets timeout, project doesn't mention it**
```
User config:    backend.timeout_ms = 600000
Project config: (no timeout_ms)
Resolved:       backend.timeout_ms = "600000"  ← user value inherited
```

**Scenario 3: User wants to force their backend despite project**
```
User config:    backend.command = "pi"
Project config: backend.command = "claude"
CLI:            autoloop run mypreset -b pi
Resolved:       backend.command = "pi"  ← CLI wins
```

**Scenario 4: AUTOLOOP_CONFIG override**
```
AUTOLOOP_CONFIG=/tmp/ci.toml
/tmp/ci.toml:   backend.command = "claude"
User config:    (ignored — env replaces user path)
Project config: backend.command = "pi"
Resolved:       backend.command = "pi"  ← project still wins over env-pointed file
```

---

## What's Deferred to v2

| Feature | Rationale |
|---------|-----------|
| System/global config (`/etc/autoloop/`) | Near-zero demand, permissions complexity |
| `extends` / `[include]` in TOML | Adds cycle detection, ordering complexity; layered merge covers the 90% case |
| 1:1 env var mapping (`AUTOLOOP_BACKEND_COMMAND`) | `AUTOLOOP_CONFIG` file pointer sufficient for v1 |
| `autoloop config init` scaffolding | Format is simple; document the path and keys |
| Layered `topology.toml` | Topology is inherently per-preset |
| Schema validation | Out of scope per brief |

## Open Questions (resolved)

1. **Should user config hot-reload?** Yes — `loadProject()` is called every iteration, and user config is loaded inside it. No additional mechanism needed.
2. **Should `AUTOLOOP_CONFIG` override just the user layer, or insert a new layer?** It replaces the user layer path (like `GIT_CONFIG_GLOBAL`). Project still wins.
3. **Should topology.toml be layered?** No — topology defines loop structure and is inherently per-preset.
