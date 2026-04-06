# Sub-task 4: Configuration, Parallel Branch Support, and Documentation

**Parent task:** `kiro-acp-backend.code-task.md`
**Modified files:** `src/harness/config-helpers.ts`, `src/harness/parallel.ts` (or `wave.ts`), `docs/configuration.md`, `docs/cli.md`
**Depends on:** Sub-task 1 (acp-client.ts), Sub-task 3 (harness integration)
**Estimated scope:** ~80 lines modified, ~40 lines docs

## Objective

Add kiro-specific configuration keys, ensure parallel branches each get their own ACP session, and document the new backend.

## Steps

### 1. Configuration keys

In `src/harness/config-helpers.ts` (or wherever config is read in `reloadLoop()`), read the new keys:

```typescript
const trustAllTools = truthy(configGet(config, "backend.trust_all_tools", "true"));
const agentName = configGet(config, "backend.agent", "");
const modelId = configGet(config, "backend.model", "");
```

These are passed to `initKiroSession()` during session creation (sub-task 3). They are only relevant when `backend.kind === "kiro"`.

### 2. Parallel branch support

In the parallel wave execution path (branch supervisor/launcher), each branch currently inherits the parent's backend spec and spawns its own process. For kiro:

- Each branch must spawn its own `kiro-cli acp` process and create its own ACP session
- The branch's `BackendSpec` carries `kind: "kiro"`, so the branch harness (`run_parallel_branch_cli` or equivalent) initializes its own session via the same `initKiroSession()` path
- Branch timeout should send `session/cancel` before killing the process
- On branch completion, `terminateSession()` cleans up the branch's ACP process

This should work naturally if the harness integration (sub-task 3) correctly initializes/terminates sessions based on `backend.kind` — each branch run goes through the same lifecycle.

Verify that the branch launch path in `src/harness/wave.ts` (or `parallel.ts`) passes the backend spec through to the branch's loop context.

### 3. Update `docs/configuration.md`

Add to the Backend section:

```markdown
| `backend.kind` | string | `"pi"` | Backend type. `"pi"` for the Pi adapter, `"kiro"` for the Kiro ACP agent, `"command"` for arbitrary commands. |
| `backend.trust_all_tools` | bool | `true` | Auto-approve all tool calls in kiro backend. Set to `false` to reject tool calls (headless mode has no approval UI). |
| `backend.agent` | string | `""` | Kiro agent name (maps to ACP `session/set_mode`). Empty uses the default agent. |
| `backend.model` | string | `""` | Model ID override (maps to ACP `session/set_model`). Empty uses the agent's default model. |
```

Add a "Kiro backend mode" section explaining:
- Persistent session across iterations (conversation history accumulates)
- Tool approval behavior
- How `backend.agent` and `backend.model` map to ACP operations
- Parallel branches get independent sessions

Kind auto-detection update: if `command` is or ends with `kiro-cli`, kind is `"kiro"`.

### 4. Update `docs/cli.md`

In the `-b` flag description:

```markdown
| `-b <backend>`, `--backend <backend>` | Override the backend. `pi` selects the Pi adapter. `kiro` selects the Kiro ACP agent (persistent session). `claude` adds `-p --dangerously-skip-permissions`. Any other value is treated as a shell command. |
```

Add a kiro example:

```bash
autoloops run autocode -b kiro "Fix the login bug"
autoloops run autocode -b kiro -- --model claude-sonnet-4
```

### 5. Preset example

Update `presets/autocode/autoloops.toml` with a commented-out kiro configuration:

```toml
# Kiro ACP backend (persistent agent session):
# backend.kind = "kiro"
# backend.command = "kiro-cli"
# backend.args = ["acp"]
# backend.trust_all_tools = true
# backend.agent = ""
# backend.model = ""
```

### Acceptance Criteria

- `backend.trust_all_tools`, `backend.agent`, and `backend.model` are read from config and passed to session creation
- Parallel branches each spawn their own `kiro-cli acp` process with an independent session
- Branch timeout sends `session/cancel` before process termination
- `docs/configuration.md` documents all new keys with the kiro backend section
- `docs/cli.md` documents `-b kiro` with examples
- Existing pi/command backends are unaffected by the new config keys (they're ignored when kind != kiro)

## Metadata

- **Complexity**: Medium
- **Parent Task**: `kiro-acp-backend.code-task.md`
- **Depends On**: Sub-task 1, Sub-task 3
