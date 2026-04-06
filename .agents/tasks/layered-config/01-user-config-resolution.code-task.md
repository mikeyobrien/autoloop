# Task 1: User Config Path Resolution and Loading

**RFC:** `docs/rfcs/layered-config.md`
**Files to modify:** `src/config.ts`
**Estimated scope:** ~40 lines added

## Objective

Add `resolveUserConfigPath()` and `loadUserConfig()` to `src/config.ts`, then wire them into `loadProject()` to create the layered merge chain.

## Steps

### 1. Export `resolveUserConfigPath()`

Add after line 4 (imports). Needs `homedir`, `platform` from `node:os`:

```typescript
import { homedir, platform } from "node:os";
```

Implementation (see RFC for full code):
- Check `process.env.AUTOLOOP_CONFIG` first — if set, return it directly
- Windows (`platform() === "win32"`): use `%APPDATA%/autoloop/config.toml`
- Linux/macOS: use `$XDG_CONFIG_HOME/autoloop/config.toml`, defaulting to `~/.config/autoloop/config.toml`
- Return `string | null` (null should not happen in practice, but guard against missing homedir)

### 2. Export `loadUserConfig()`

```typescript
export function loadUserConfig(): Config {
  const path = resolveUserConfigPath();
  if (!path || !existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}
```

Key detail: returns raw parsed+stringified TOML, NOT merged with `defaults()`. Defaults are applied once in the final merge.

### 3. Extract `loadProjectFile()` (private)

Extract the file-loading portion of the current `load()` into a private helper:

```typescript
function loadProjectFile(projectDir: string): Config {
  const path = resolveConfigPath(projectDir);
  if (!existsSync(path)) return {};
  return stringifyValues(parseRawToml(readFileSync(path, "utf-8")));
}
```

Same pattern as `loadUserConfig()` — raw parsed, no defaults merge.

### 4. Modify `loadProject()`

Change from:
```typescript
export function loadProject(projectDir: string): Config {
  return load(resolveConfigPath(projectDir));
}
```

To:
```typescript
export function loadProject(projectDir: string): Config {
  const userConfig = loadUserConfig();
  const projectConfig = loadProjectFile(projectDir);
  return deepMerge(defaults(), deepMerge(userConfig, projectConfig));
}
```

### 5. Keep `load()` backward-compatible

The existing `load()` function is used by `loadProject()` today. After refactoring, check if anything else calls `load()` directly. If not, it can be removed. If it is used elsewhere, keep it but consider marking it as legacy.

## Testing

### Unit tests (`test/config/layered.test.ts` — new file)

1. **No user config**: `loadProject(dir)` returns same result as today (just defaults + project file)
2. **User config exists, no project config**: user values merged with defaults
3. **Both exist, project wins**: project `backend.command = "claude"` overrides user `backend.command = "pi"`
4. **User sets key, project doesn't mention it**: user value preserved in result
5. **`AUTOLOOP_CONFIG` env var**: overrides the default user config path
6. **Empty user config file**: treated as `{}`, no effect on merge
7. **User config with unknown sections**: passes through (no schema enforcement)

### Mocking strategy

Use `process.env.AUTOLOOP_CONFIG` pointed at temp files to avoid touching real `~/.config`. Create temp TOML files in the test's tmpdir.

## Acceptance criteria

- `loadProject()` produces identical output when no user config file exists
- User config merges correctly with project config (project wins)
- `AUTOLOOP_CONFIG` env var redirects user config path
- All existing tests continue to pass
- `resolveUserConfigPath` and `loadUserConfig` are exported (needed by task 3)
