# Task: Kiro ACP Backend — First-Class Backend with Agent Support

## Description

Add `kiro` as a first-class backend kind in autoloop, communicating with `kiro-cli acp` over the Agent Client Protocol (ACP) — a JSON-RPC 2.0 protocol over stdio. Unlike the existing `pi` and `command` backends which shell out per iteration, the `kiro` backend maintains a persistent ACP session across the entire run, sending prompts via `session/prompt` and receiving streamed responses via `session/notification`. This enables agent features like tool approval, MCP server passthrough, session persistence, and model switching mid-run.

## Background

### Current backend architecture

Autoloop has two backend kinds today:

- `pi` — Shells out to the Pi adapter (`src/pi-adapter.ts`) each iteration. The adapter invokes `pi -p --mode json --no-session`, parses the NDJSON stream, and extracts the final text output. Stateless between iterations.
- `command` — Shells out to an arbitrary command each iteration, passing the prompt as a CLI arg or via stdin. Captures stdout. Stateless between iterations.

Both are invoked via `buildBackendShellCommand()` in `src/backend/index.ts`, which wraps the child process in a shell script with signal handling. The harness calls `runProcess()` synchronously per iteration and reads the output.

Key files:
- `src/backend/types.ts` — `BackendSpec`, `BackendRunResult`, `BackendCommandContext`
- `src/backend/index.ts` — `buildBackendShellCommand()`, `runBackendCommand()`, `normalizeProviderKind()`
- `src/backend/run-pi.ts` — `buildPiAdapterInvocation()`
- `src/backend/run-command.ts` — `buildCommandInvocation()`, `runShellCommand()`
- `src/pi-adapter.ts` — Python bridge script, prompt resolution, NDJSON parsing
- `src/harness/iteration.ts` — `runIteration()` calls `runProcess()` and reads output
- `src/harness/types.ts` — `LoopContext.backend`, `BackendSpec` shape
- `src/commands/run.ts` — `-b` flag parsing, `backendOverrideSpec()`

### Kiro ACP protocol

Kiro CLI exposes an ACP agent via `kiro-cli acp` (stdin/stdout JSON-RPC 2.0). The protocol flow:

1. `initialize` — handshake, exchange capabilities
2. `session/new` — create a session (returns `sessionId`, available models, modes)
3. `session/prompt` — send a prompt (returns `PromptResponse` with `stopReason`)
4. `session/notification` — streamed updates: `agent_message_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`
5. `session/cancel` — interrupt current turn
6. `session/set_mode` — switch agent config
7. `session/set_model` — change model

The ACP SDK (`@agentclientprotocol/sdk`) provides `ClientSideConnection` for managing the JSON-RPC transport over stdio streams.

Key difference from existing backends: ACP is a persistent, bidirectional session — not a one-shot shell command. The agent process stays alive across iterations, maintaining conversation history, tool permissions, and MCP server connections.

## Reference Documentation

- ACP protocol spec: https://agentclientprotocol.com/get-started/introduction
- ACP SDK (npm): `@agentclientprotocol/sdk`
- Autoloop backend module: `src/backend/`
- Autoloop harness iteration: `src/harness/iteration.ts`
- Autoloop CLI run command: `src/commands/run.ts`
- Autoloop configuration: `docs/configuration.md`

## Technical Requirements

### 1. ACP client module (`src/backend/acp-client.ts`)

Create a persistent ACP client that manages the `kiro-cli acp` child process:

- Spawn `kiro-cli acp` (or configured command) as a child process with stdio pipes
- Implement the ACP handshake (`initialize`)
- Create a session (`session/new` with `cwd` and optional `mcpServers`)
- Send prompts (`session/prompt`) and collect the full agent response text from streamed `agent_message_chunk` notifications
- Handle `tool_call` / `tool_call_update` notifications (log them; auto-approve in trust-all mode)
- Handle `session/cancel` for timeout-based interruption
- Handle process lifecycle: spawn on first iteration, reuse across iterations, terminate on loop end
- Parse NDJSON from stdout, route JSON-RPC notifications vs responses
- Capture the assembled text output as a string (matching `BackendRunResult.output` contract)

### 2. ACP backend runner (`src/backend/run-kiro.ts`)

Create the iteration-level runner that the harness calls:

```typescript
export interface KiroSessionState {
  process: ChildProcess;
  connection: AcpClientConnection;
  sessionId: string;
}

export async function runKiroIteration(
  state: KiroSessionState,
  prompt: string,
  timeoutMs: number,
): Promise<BackendRunResult>
```

- Send the prompt via `session/prompt`
- Collect `agent_message_chunk` text deltas until `stopReason: EndTurn` or `stopReason: Cancelled`
- On timeout: send `session/cancel`, wait briefly, return `timedOut: true`
- On error: capture error text, return `exitCode: 1`
- Return assembled text as `output`, matching the `BackendRunResult` interface

### 3. Session lifecycle management

- `initKiroSession(spec: BackendSpec, cwd: string): Promise<KiroSessionState>` — spawn process, initialize, create session
- `terminateKiroSession(state: KiroSessionState): Promise<void>` — graceful shutdown (SIGTERM, wait, SIGKILL fallback)
- The harness must call `initKiroSession` before the first iteration and `terminateKiroSession` after the loop ends (success, failure, or signal)
- Store `KiroSessionState` on `LoopContext` or as a module-level singleton scoped to the run

### 4. Backend kind registration

Update `src/backend/index.ts`:
- Add `"kiro"` as a recognized backend kind alongside `"pi"` and `"command"`
- In `normalizeProviderKind()`: detect `kiro-cli` or `kiro` command → return `"kiro"`
- In `buildBackendShellCommand()`: for `kind === "kiro"`, skip shell wrapping — the ACP client handles process management directly

Update `src/commands/run.ts`:
- In `backendOverrideSpec()`: add `"kiro"` case:
  ```typescript
  if (backend === "kiro") {
    return { kind: "kiro", command: "kiro-cli", args: ["acp"], prompt_mode: "acp" };
  }
  ```

### 5. Harness integration

Update `src/harness/iteration.ts` (`runIteration`):
- Before the existing `runProcess()` call, check `loop.backend.kind === "kiro"`
- If kiro: call `runKiroIteration()` instead of `runProcess(buildBackendShellCommand(...))`
- The kiro path must still produce a `BackendRunResult` with `output`, `exitCode`, `timedOut` so the rest of the iteration flow (journal append, event extraction, completion check) works unchanged

Update `src/harness/index.ts` (run lifecycle):
- After `buildLoopContext()`, if `backend.kind === "kiro"`, call `initKiroSession()`
- After the loop ends, call `terminateKiroSession()`
- On SIGINT/SIGTERM, ensure the kiro process is cleaned up

### 6. Configuration

Add to `docs/configuration.md` and support in config parsing:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backend.kind` | string | `"pi"` | Now accepts `"kiro"` in addition to `"pi"` and `"command"` |
| `backend.trust_all_tools` | bool | `true` | Auto-approve all tool calls (default true for headless loop operation) |
| `backend.agent` | string | `""` | Kiro agent name to use (maps to `session/set_mode`). Empty = default agent. |
| `backend.model` | string | `""` | Model ID override (maps to `session/set_model`). Empty = agent default. |

### 7. Review (metareview) support

The review pass should also work with the kiro backend:
- Reuse the same ACP session (same process, same session ID) for review iterations
- The review prompt is sent as a normal `session/prompt` — the agent's conversation history provides continuity
- Alternatively, if review isolation is needed, create a second ACP session within the same process

### 8. Parallel branch support

For parallel waves, each branch needs its own ACP session:
- Branch runs should spawn their own `kiro-cli acp` process (independent session)
- The branch's `BackendSpec` should carry `kind: "kiro"` so the branch harness initializes its own session
- Branch timeout should trigger `session/cancel` before process termination

## Dependencies

- `@agentclientprotocol/sdk` npm package (for `ClientSideConnection`, `ndJsonStream`, protocol types)
- `kiro-cli` binary available on PATH (or configured via `backend.command`)

## Implementation Approach

1. Start with the ACP client module — get `initialize` → `session/new` → `session/prompt` → collect response working as a standalone script
2. Wire it into the backend module as `kind: "kiro"` with the `-b kiro` CLI flag
3. Integrate session lifecycle into the harness run loop
4. Add tool approval handling (default: trust all for headless operation)
5. Add configuration keys and documentation
6. Test with a real `kiro-cli acp` process against a simple preset

## Acceptance Criteria

1. `autoloops run autocode -b kiro "Fix the bug"` spawns `kiro-cli acp`, creates a session, and runs the loop with prompts sent via ACP
2. The agent process persists across iterations — conversation history accumulates naturally
3. Tool calls are auto-approved by default (`trust_all_tools: true`)
4. Timeout triggers `session/cancel` and returns `timedOut: true`
5. Backend errors (process crash, ACP error) return `exitCode: 1` with error text
6. The kiro process is cleaned up on loop completion, failure, or signal
7. `backend.agent` switches the agent mode via `session/set_mode` at session creation
8. `backend.model` overrides the model via `session/set_model` at session creation
9. Parallel branches each get their own independent ACP session
10. Review iterations work through the same ACP session
11. Journal entries, event extraction, and completion detection work identically to other backends
12. `autoloops inspect output <N>` shows the agent's text response for each iteration
13. Existing `pi` and `command` backends are completely unchanged

## Sub-tasks

| # | Path | Title | Depends On | Complexity |
|---|------|-------|------------|------------|
| 1 | `kiro-acp-backend-1-acp-client.code-task.md` | ACP Client Module | None | Medium |
| 2 | `kiro-acp-backend-2-backend-registration.code-task.md` | Backend Kind Registration and CLI Flag | 1 | Small |
| 3 | `kiro-acp-backend-3-harness-integration.code-task.md` | Harness Integration — Session Lifecycle and Iteration Dispatch | 1, 2 | Medium |
| 4 | `kiro-acp-backend-4-config-parallel-docs.code-task.md` | Configuration, Parallel Branch Support, and Documentation | 1, 3 | Medium |

## Execution Order

Sub-tasks 1 and 2 can be developed in sequence (2 depends on 1's types). Sub-task 3 depends on both. Sub-task 4 depends on 1 and 3 but can be partially worked in parallel with 3 (docs and config reading are independent of the harness wiring).

## Metadata

- **Complexity**: Large
- **Labels**: backend, acp, kiro, agent-protocol, integration
- **Required Skills**: TypeScript, JSON-RPC, child process management, ACP protocol, autoloop harness internals
