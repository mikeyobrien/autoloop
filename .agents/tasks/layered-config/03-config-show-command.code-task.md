# Task 3: `autoloop config show` and `autoloop config path` Commands

**RFC:** `docs/rfcs/layered-config.md`
**Files to create:** `src/commands/config.ts`
**Files to modify:** `src/config.ts` (add provenance), CLI entry point
**Depends on:** Task 1

## Objective

Add `autoloop config show` (resolved config with provenance annotations) and `autoloop config path` (print user config path) subcommands.

## Steps

### 1. Add provenance-aware loading to `src/config.ts`

Export `loadProjectWithProvenance()`:

```typescript
export type Provenance = Record<string, string>;

export function loadProjectWithProvenance(projectDir: string): {
  config: Config;
  provenance: Provenance;
} {
  const sources: Array<{ config: Config; label: string }> = [
    { config: defaults(), label: "default" },
    { config: loadUserConfig(), label: `user (${resolveUserConfigPath() ?? "none"})` },
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
```

Add private `recordProvenance()` helper (see RFC for implementation).

Note: `resolveConfigPath` and `loadProjectFile` are currently private. Either export them or make `loadProjectWithProvenance` use them internally. Prefer keeping them private and putting the provenance function in the same module.

### 2. Create `src/commands/config.ts`

```typescript
export function configShow(projectDir: string, json: boolean): void { ... }
export function configPath(): void { ... }
```

**`configShow`:**
- Call `loadProjectWithProvenance(projectDir)`
- Format output as TOML-like with `# source` comments on each line
- If `--json`: output `{ config, provenance }` as JSON

**`configPath`:**
- Call `resolveUserConfigPath()`
- Print the path (or "no user config path resolved" if null)
- Print whether the file exists

### 3. Wire into CLI entry point

Find the CLI argument parser (likely in `src/cli.ts` or the main entry). Add:
- `autoloop config show [--json] [project-dir]`
- `autoloop config path`

If the CLI uses a subcommand pattern, follow the existing convention for `inspect`, `memory`, etc.

## Output format

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
```

## Testing

1. `configShow` with only defaults → all keys annotated as "default"
2. `configShow` with user + project → correct provenance per key
3. `configPath` prints the resolved path
4. `--json` flag produces valid JSON with both config and provenance

## Acceptance criteria

- `autoloop config show` displays resolved config with per-key provenance
- `autoloop config path` prints user config file path and existence
- `--json` flag works for machine-readable output
- Not in the hot path — only invoked explicitly by user
