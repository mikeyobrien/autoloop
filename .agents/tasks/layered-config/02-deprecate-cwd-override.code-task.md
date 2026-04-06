# Task 2: Deprecate cwd-based Backend Override

**RFC:** `docs/rfcs/layered-config.md`
**Files to modify:** `src/commands/run.ts`
**Depends on:** Task 1

## Objective

Add a deprecation warning when the cwd-based `applyGlobalBackendOverride()` fires AND a user config file exists. The override continues to work — this is a soft deprecation.

## Steps

### 1. Import `resolveUserConfigPath` in `commands/run.ts`

```typescript
import { resolveUserConfigPath } from "../config.js";
```

### 2. Add deprecation warning inside `applyGlobalBackendOverride()`

At `src/commands/run.ts:143`, after the existing early-return guards, add:

```typescript
const userConfigPath = resolveUserConfigPath();
if (userConfigPath && existsSync(userConfigPath)) {
  console.error(
    `[deprecation] cwd-based backend override is deprecated. ` +
    `Your user config at ${userConfigPath} now handles this. ` +
    `See: autoloop config path`
  );
}
```

The override still applies — we just warn. The message suggests the migration path.

### 3. One-time warning (optional improvement)

To avoid spamming on every invocation in a chain, use a module-level `let warned = false` guard. Low priority — chains are short-lived.

## Testing

- Verify that when both cwd override and user config exist, a deprecation message is emitted to stderr
- Verify that when only cwd override exists (no user config), no warning is emitted
- Verify that the override still applies regardless of the warning

## Acceptance criteria

- `applyGlobalBackendOverride()` still works exactly as before
- Deprecation message printed to stderr when user config also exists
- No warning when user config does not exist
