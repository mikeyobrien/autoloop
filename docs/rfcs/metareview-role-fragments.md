# RFC: Metareview Per-Run Role Fragments

**Status:** Draft
**Slug:** `metareview-role-fragments`
**Date:** 2026-04-06

## Summary

Add a mechanism for the metareviewer to write per-run, per-role prompt fragments that are injected into role prompts during prompt assembly. Fragments live under the run state directory, are picked up on `reloadLoop()`, and are rendered as a dedicated section in the iteration prompt so agents actually see them.

## Motivation

The metareviewer currently has two levers:

1. **Edit `roles/*.md`** — permanent, mutates shared templates, affects all future runs.
2. **Edit working files** (`context.md`, `progress.md`) — broadcast to all roles, not targeted.

Neither supports **per-run, per-role** guidance. Loop memory entries (mem-11, mem-13, meta-24, meta-32, meta-33) document repeated failures where prompt-level instructions to specific roles were ignored. The metareviewer needs a way to inject targeted, persistent guidance into a specific role's prompt section — scoped to the current run only.

## Design

### Fragment Storage

Fragments are plain Markdown files stored at:

```
<stateDir>/role-fragments/<roleId>.md
```

For example, a fragment targeting the `builder` role in run `run-abc123`:

```
.autoloop/runs/run-abc123/role-fragments/builder.md
```

**Properties:**
- One file per role. The filename (minus `.md`) is the role ID.
- The metareviewer writes or overwrites the file on each metareview pass.
- Overwrite semantics: the metareview agent reads the existing fragment (if any), synthesizes updated guidance, and writes the replacement. History is preserved in the journal.
- Automatic cleanup: files live under `stateDir`, which is per-run.

### Fragment Loading

A new function `resolveRunFragments()` reads all files in `<stateDir>/role-fragments/` and returns a `Map<string, string>` (roleId → fragment text). This mirrors the shape of `resolveProfileFragments()` in `src/profiles.ts`.

```typescript
// src/run-fragments.ts

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export function resolveRunFragments(
  stateDir: string,
  roleIds: string[],
): { fragments: Map<string, string>; warnings: string[] } {
  const dir = join(stateDir, "role-fragments");
  const fragments = new Map<string, string>();
  const warnings: string[] = [];

  if (!existsSync(dir)) return { fragments, warnings };

  const roleIdSet = new Set(roleIds);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const roleId = basename(file, ".md");
    if (!roleIdSet.has(roleId)) {
      warnings.push(
        `run fragment "${file}" does not match any role; ignoring`
      );
      continue;
    }
    fragments.set(roleId, readFileSync(join(dir, file), "utf-8"));
  }

  return { fragments, warnings };
}
```

### Integration into `reloadLoop()`

In `src/harness/config-helpers.ts`, after profile fragments are applied (line 381), resolve and apply per-run fragments:

```typescript
// After profile fragment application (line 386):

// Resolve and apply per-run role fragments (metareview-authored)
const runFragResult = runFragments.resolveRunFragments(
  loop.paths.stateDir,
  finalTopology.roles.map((r) => r.id),
);
if (runFragResult.fragments.size > 0) {
  finalTopology = {
    ...finalTopology,
    roles: profiles.applyProfileFragments(
      finalTopology.roles,
      runFragResult.fragments,
    ),
  };
}
for (const w of runFragResult.warnings) {
  process.stderr.write(`run-fragment warning: ${w}\n`);
}
```

This reuses `applyProfileFragments()` — it simply appends text to `role.prompt`. The stacking order is: base role prompt → profile fragments → run fragments.

### Fragment Rendering in Iteration Prompt

**Problem:** `renderRoles()` in `src/topology.ts` calls `promptSummary()` which only renders the first line of each role's prompt. Fragments appended to `role.prompt` are invisible.

**Solution:** Add a new section in `renderIterationPromptText()` (in `src/harness/prompt.ts`) that renders run fragments for the currently suggested role(s). This section appears after the topology block and before iteration metadata.

```typescript
// In renderIterationPromptText(), after topology.renderWithContext() (line 287):

roleFragmentText(loop.paths.stateDir, allowedRoles) +
```

Implementation:

```typescript
function roleFragmentText(stateDir: string, suggestedRoles: string[]): string {
  const dir = join(stateDir, "role-fragments");
  if (!existsSync(dir)) return "";

  const sections: string[] = [];
  for (const roleId of suggestedRoles) {
    const file = join(dir, `${roleId}.md`);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf-8").trim();
    if (content) {
      sections.push(
        `Metareview guidance for role \`${roleId}\`:\n${content}`
      );
    }
  }

  if (sections.length === 0) return "";
  return "\n" + sections.join("\n\n") + "\n\n";
}
```

**Why a separate section instead of expanding `renderRoles()`:**
- `renderRoles()` renders all roles; fragments should only appear for the currently suggested role(s) to conserve prompt space.
- The topology block stays compact and familiar.
- Fragment content is visually distinct ("Metareview guidance for role ..."), so agents recognize it as supplementary guidance.

### Metareview Prompt Update

Add the fragment directory to the safe-edit list in `renderReviewPromptText()` (prompt.ts:356):

```
<stateDir>/role-fragments/<roleId>.md
```

Add a guidance section to the metareview prompt explaining the fragment mechanism:

```
To steer a specific role in subsequent iterations, write targeted guidance to:
  <stateDir>/role-fragments/<roleId>.md
The content will be injected into that role's prompt on the next iteration.
Overwrite (not append) — synthesize prior guidance with new observations.
```

### Inspect Command

Extend `autoloops inspect` with a `fragments` subcommand:

```
autoloops inspect fragments [--format md|json]
```

Output lists each role fragment file, its target role, and content. This uses the same `resolveRunFragments()` function.

### Fragment Rendering in Review Prompt

The metareview prompt should also render existing fragments so the reviewer can see what guidance is already active. Add the same `roleFragmentText()` call to `renderReviewPromptText()`, but render **all** role fragments (not just suggested roles) since the metareview agent needs full visibility.

```typescript
function allRoleFragmentText(stateDir: string): string {
  const dir = join(stateDir, "role-fragments");
  if (!existsSync(dir)) return "";

  const sections: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const roleId = basename(file, ".md");
    const content = readFileSync(join(dir, file), "utf-8").trim();
    if (content) {
      sections.push(`Active fragment for \`${roleId}\`:\n${content}`);
    }
  }

  if (sections.length === 0) return "";
  return "\nActive role fragments:\n" + sections.join("\n\n") + "\n\n";
}
```

## Stacking Order

When a role prompt is assembled, content stacks in this order:

1. **Base prompt** — from `topology.toml` role definition or `roles/<roleId>.md`
2. **Profile fragments** — from `.autoloop/profiles/<name>/<preset>/<roleId>.md` (cross-run, user-curated)
3. **Run fragments** — from `<stateDir>/role-fragments/<roleId>.md` (per-run, metareview-authored)

Run fragments have the highest priority (last-writer-wins in prompt attention). This is intentional: the metareviewer's per-run observations should override generic profile guidance when they conflict.

## Write Access Control

Only the metareview agent should write fragments. This is enforced by convention, not code:

- The `renderReviewPromptText()` mentions the fragment path in the safe-edit list.
- The `renderIterationPromptText()` does **not** mention the fragment directory as a writable path.
- Normal iteration roles have no prompt instruction to write fragments.

No file-system-level access control is needed — the harness trusts prompt guidance to scope write behavior.

## Interaction with Existing Systems

| System | Relationship |
|--------|-------------|
| Profile fragments (`profiles.ts`) | Complementary. Profile fragments are cross-run and user-curated. Run fragments are per-run and metareview-authored. Both use the same `applyProfileFragments()` apply function. |
| Operator guidance RFC (`loop-guidance-injection.md`) | Complementary. Operator guidance is one-shot and human-authored. Run fragments are persistent and automated. Different delivery mechanisms. |
| Working files (`context.md`, `progress.md`) | Complementary. Working files are broadcast to all roles. Fragments are role-targeted. |
| Memory system | Different scope. Memory persists across runs. Fragments are ephemeral to the current run. |

## File Changes Summary

| File | Change |
|------|--------|
| `src/run-fragments.ts` | New file. `resolveRunFragments()` function. |
| `src/harness/config-helpers.ts` | `reloadLoop()`: add run-fragment resolution after profile fragments. |
| `src/harness/prompt.ts` | `renderIterationPromptText()`: add `roleFragmentText()` section. `renderReviewPromptText()`: add fragment path to safe-edit list, add `allRoleFragmentText()` section, add usage guidance. |
| `src/commands/inspect.ts` | Add `fragments` subcommand. |
| `test/` | Tests for `resolveRunFragments()`, prompt rendering with fragments, reload integration. |
