# RFC: Kiro Agent Role Mapping

**Slug:** `kiro-agent-role-mapping`
**Status:** Draft
**Date:** 2026-04-06

## Summary

Add an optional `agent` field to topology roles so each role in a loop can run with a different kiro agent (mode). Users override role→agent mappings via CLI flags, project config, or user config — without editing builtin presets.

## Motivation

Today `backend.agent` sets a single global kiro agent for the entire loop. But roles have fundamentally different jobs — a `builder` role benefits from `gpu-coder` while a `critic` role benefits from `gpu-reviewer`. Forcing one agent across all roles wastes the specialization that kiro agents provide.

## Design

### 1. Topology: `agent` field on roles

Add an optional `agent` string to the `Role` interface and parse it from `topology.toml`:

```toml
# topology.toml — preset author sets defaults
[[role]]
id = "builder"
agent = "gpu-coder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/build.md"

[[role]]
id = "critic"
agent = "gpu-reviewer"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"
```

Roles without `agent` inherit the global `backend.agent` fallback.

### 2. Config override: `[agents]` section

Users override per-role agents in `autoloops.toml` or `~/.config/autoloop/config.toml`:

```toml
# autoloops.toml or user config
[agents]
builder = "gpu-coder"
critic = "gpu-reviewer"
planner = "gpu-multiagent-planner"
```

Flat dot-notation also works: `agents.builder = "gpu-coder"`.

### 3. CLI override: `--agent-map`

```bash
autoloop run autocode -b kiro --agent-map builder=gpu-coder,critic=gpu-reviewer "task"
```

Parsed as CSV of `role=agent` pairs. Stored in `RunOptions.agentMap` and passed through to `LoopContext`.

### 4. Resolution order

For each role, the resolved agent is the first non-empty value from:

1. CLI `--agent-map` for that role ID
2. Project config `[agents]` section for that role ID
3. User config `[agents]` section for that role ID
4. Topology `[[role]]` `agent` field (preset default)
5. Global `backend.agent`
6. Empty string (no mode switch — kiro uses its default)

Steps 2–3 are handled automatically by the existing `config.loadLayered()` + `deepMerge` — the `[agents]` section merges like any other config section. Step 1 is applied on top in `reloadLoop()`.

### 5. Per-iteration mode switching

The mode switch happens in `runIteration()`, before the backend call:

```
iterate(loop, iteration)
  → reloadLoop(loop)           // re-reads config, resolves agent mappings onto roles
  → runIteration(loop, iter)
    → buildIterationContext()   // determines allowedRoles from routing
    → resolveIterationAgent()   // NEW: pick agent from suggested role(s)
    → setKiroModeSync()         // NEW: call setSessionMode if agent changed
    → runKiroIterationSync()    // existing prompt call
```

**Agent selection logic** (`resolveIterationAgent`):
- If exactly 1 role is suggested → use that role's `agent`
- If multiple roles are suggested → use the first suggested role's `agent`
- If no roles or no topology → use global `backend.agent` fallback
- If resolved agent equals the current session agent → skip the `setSessionMode` call

### 6. Worker protocol extension

Add a `set_mode` command to the kiro-worker SharedArrayBuffer protocol:

```typescript
// kiro-worker.ts — new command handler
case "set_mode": {
  if (!session) return { ok: false, error: "no session" };
  await session.connection.setSessionMode({
    sessionId: session.sessionId,
    modeId: cmd.modeId,
  });
  return { ok: true };
}
```

```typescript
// kiro-bridge.ts — new sync wrapper
export function setKiroModeSync(handle: KiroSessionHandle, modeId: string): void {
  const result = sendCommand(handle, { type: "set_mode", modeId });
  if (!result.ok) throw new Error("Failed to set kiro mode: " + result.error);
}
```

### 7. Changes to existing interfaces

**`Role` interface** (topology.ts):
```typescript
export interface Role {
  id: string;
  prompt: string;
  promptFile: string;
  emits: string[];
  agent: string;  // NEW — resolved agent/mode ID, empty = inherit fallback
}
```

**`LoopContext`** (harness/types.ts) — add to `store`:
```typescript
store: {
  ...existing,
  kiro_current_agent: string;  // tracks current session mode to avoid redundant switches
}
```

**`RunOptions`** (harness/types.ts):
```typescript
export interface RunOptions {
  ...existing,
  agentMap?: Record<string, string>;  // CLI --agent-map overrides
}
```

### 8. Agent mapping resolution in `reloadLoop()`

In `config-helpers.ts`, after profile fragments are applied:

```typescript
// Resolve agent mappings: CLI > config [agents] section > topology default
const configAgents = readAgentsConfig(cfg);  // reads [agents] section
const cliAgents = loop.runtime.agentMap ?? {};
const mergedAgents = { ...configAgents, ...cliAgents };
finalTopology = {
  ...finalTopology,
  roles: applyAgentMappings(finalTopology.roles, mergedAgents, globalAgent),
};
```

Where `applyAgentMappings` sets each role's `agent` field:
- If `mergedAgents[role.id]` exists → use it
- Else if `role.agent` is non-empty (from topology.toml) → keep it
- Else → set to `globalAgent` (from `backend.agent`)

Note: use `||` not `??` for fallthrough — `role.agent` is `""` (not null), so `??` would not fall through to the global agent.

### 9. Prompt rendering

The topology role deck already renders role metadata. Add agent to the display when set:

```
Role deck:
- role `builder`
  agent: gpu-coder
  emits: review.ready, build.blocked
  prompt: You are the builder.
```

This gives the model visibility into which agent is active for each role.

## Non-kiro backends

When `backend.kind` is not `"kiro"`, the `agent` field is parsed and stored but the mode-switch call is skipped. The field is inert — no errors, no warnings. This keeps topology files portable across backends.

## Backward compatibility

- Loops without `agent` fields work exactly as before — no agent field means no mode switching
- `backend.agent` continues to work as the global fallback
- Existing presets don't need changes (agent fields are optional)
- Non-kiro backends ignore agent fields silently

## Example: autocode with agents

```toml
# presets/autocode/topology.toml
name = "autocode"
completion = "task.complete"

[[role]]
id = "planner"
agent = "gpu-multiagent-planner"
emits = ["tasks.ready"]
prompt_file = "roles/planner.md"

[[role]]
id = "builder"
agent = "gpu-coder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/build.md"

[[role]]
id = "critic"
agent = "gpu-reviewer"
emits = ["review.passed", "review.rejected"]
prompt_file = "roles/critic.md"

[[role]]
id = "finalizer"
agent = "gpu-multiagent-ops"
emits = ["queue.advance", "finalization.failed", "task.complete"]
prompt_file = "roles/finalizer.md"
```

User override without editing the preset:
```toml
# ~/.config/autoloop/config.toml
[agents]
builder = "gpu-dev"
critic = "gpu-dev"
```

Or one-off from CLI:
```bash
autoloop run autocode -b kiro --agent-map builder=gpu-dev "implement feature X"
```

## Files changed

| File | Change |
|------|--------|
| `src/topology.ts` | Add `agent` to `Role` interface, parse from TOML |
| `src/harness/types.ts` | Add `agentMap` to `RunOptions`, `kiro_current_agent` to store |
| `src/harness/config-helpers.ts` | Read `[agents]` config, apply mappings in `reloadLoop()` |
| `src/harness/iteration.ts` | Resolve iteration agent, call `setKiroModeSync` before prompt |
| `src/backend/kiro-bridge.ts` | Add `setKiroModeSync()` |
| `src/backend/kiro-worker.ts` | Add `set_mode` command handler |
| `src/commands/run.ts` | Parse `--agent-map` flag |
| `docs/topology.md` | Document `agent` field |
| `docs/configuration.md` | Document `[agents]` section |
