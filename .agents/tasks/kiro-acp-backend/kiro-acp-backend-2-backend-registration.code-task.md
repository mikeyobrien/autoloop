# Sub-task 2: Backend Kind Registration and CLI Flag

**Parent task:** `kiro-acp-backend.code-task.md`
**Modified files:** `src/backend/index.ts`, `src/backend/types.ts`, `src/commands/run.ts`
**New files:** `src/backend/run-kiro.ts`
**Depends on:** Sub-task 1 (acp-client.ts)
**Estimated scope:** ~80 lines

## Objective

Register `kiro` as a recognized backend kind, add the `-b kiro` CLI flag, and create the iteration-level runner that bridges the ACP client into the `BackendRunResult` contract.

## Steps

### 1. Create `src/backend/run-kiro.ts`

```typescript
import type { AcpSession, AcpPromptResult } from "./acp-client.js";
import type { BackendRunResult } from "./types.js";

export async function runKiroIteration(
  session: AcpSession,
  prompt: string,
  timeoutMs: number,
): Promise<BackendRunResult>
```

Implementation:
1. Call `sendPrompt(session, prompt, timeoutMs)` from the ACP client
2. Map the `AcpPromptResult` to `BackendRunResult`:
   - `output` = assembled text
   - `exitCode` = 0 if `stopReason` is `EndTurn`, 1 otherwise
   - `timedOut` = from the ACP result
   - `providerKind` = `"kiro"`
   - `errorCategory` = `"none"` | `"timeout"` | `"non_zero_exit"` based on result

### 2. Update `src/backend/index.ts`

In `normalizeProviderKind()`:
```typescript
if (spec.kind === "kiro") return "kiro";
if (spec.command === "kiro-cli" || spec.command.endsWith("/kiro-cli")) return "kiro";
```

In `normalizeBackendLabel()`:
```typescript
if (base === "kiro-cli") return "kiro";
```

No changes to `buildBackendShellCommand()` — the kiro backend bypasses shell invocation entirely. The harness will call `runKiroIteration()` directly instead.

### 3. Update `src/commands/run.ts`

In `backendOverrideSpec()`, add the `kiro` case:

```typescript
if (backend === "kiro") {
  return { kind: "kiro", command: "kiro-cli", args: ["acp"], prompt_mode: "acp" };
}
```

This means `autoloops run autocode -b kiro "Fix the bug"` sets the backend to kiro.

Also support `kiro-cli` as a command name (auto-detect):
```typescript
if (backend === "kiro-cli" || backend.endsWith("/kiro-cli")) {
  return { kind: "kiro", command: backend, args: ["acp"], prompt_mode: "acp" };
}
```

### 4. Update `src/backend/types.ts`

Add `prompt_mode: "acp"` as a recognized value in documentation comments. No type changes needed since `promptMode` is already `string`.

### Acceptance Criteria

- `backendOverrideSpec("kiro")` returns `{ kind: "kiro", command: "kiro-cli", args: ["acp"], prompt_mode: "acp" }`
- `normalizeProviderKind({ kind: "kiro", ... })` returns `"kiro"`
- `runKiroIteration()` returns a valid `BackendRunResult` from an ACP prompt response
- `-b kiro` is accepted by the CLI parser without error

## Metadata

- **Complexity**: Small
- **Parent Task**: `kiro-acp-backend.code-task.md`
- **Depends On**: Sub-task 1
