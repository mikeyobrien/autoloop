# Sub-task 1: ACP Client Module

**Parent task:** `kiro-acp-backend.code-task.md`
**New files:** `src/backend/acp-client.ts`
**Depends on:** None
**Estimated scope:** ~200 lines

## Objective

Create a persistent ACP client that manages a `kiro-cli acp` child process, handles the JSON-RPC 2.0 protocol over stdio, and exposes a clean async API for session management and prompt execution.

## Steps

### 1. Add `@agentclientprotocol/sdk` dependency

Add to `package.json`. This provides `ClientSideConnection`, `ndJsonStream`, and all ACP schema types.

### 2. Create `src/backend/acp-client.ts`

Implement the core ACP client:

```typescript
export interface AcpClientOptions {
  command: string;        // e.g. "kiro-cli"
  args: string[];         // e.g. ["acp"]
  cwd: string;
  trustAllTools?: boolean;
  agentName?: string;     // maps to session/set_mode
  modelId?: string;       // maps to session/set_model
}

export interface AcpSession {
  sessionId: string;
  connection: ClientSideConnection;
  process: ChildProcess;
}

export interface AcpPromptResult {
  output: string;
  stopReason: string;
  timedOut: boolean;
  error?: string;
}
```

Functions:

- `spawnAcpProcess(command: string, args: string[]): ChildProcess` — spawn with `stdio: ['pipe', 'pipe', 'pipe']`, route stderr to a log buffer
- `initializeConnection(process: ChildProcess): Promise<ClientSideConnection>` — create NDJSON transport over stdin/stdout, call `connection.initialize()` with client info
- `createSession(connection, cwd, options): Promise<AcpSession>` — call `connection.newSession({ cwd, mcpServers: [] })`, optionally call `setSessionMode` and `setSessionModel`
- `sendPrompt(session, prompt, timeoutMs): Promise<AcpPromptResult>` — send `connection.prompt()`, collect `agent_message_chunk` text deltas, handle timeout via `connection.cancel()`, return assembled text
- `terminateSession(session): Promise<void>` — SIGTERM, wait 3s, SIGKILL fallback

### 3. Handle session notifications

Implement the `Client` interface from the ACP SDK:

- `sessionUpdate(params)` — accumulate `agent_message_chunk` text into a buffer, track `tool_call` events for logging
- `requestPermission(params)` — auto-approve with `allow_once` when `trustAllTools` is true, otherwise reject (headless mode has no UI)

### 4. Handle timeout

When `timeoutMs` elapses during a prompt:
- Send `connection.cancel({ sessionId })`
- Wait up to 2s for the `Cancelled` stop reason
- If no response, mark as timed out

### Acceptance Criteria

- `spawnAcpProcess()` starts a `kiro-cli acp` child process with stdio pipes
- `initializeConnection()` completes the ACP handshake
- `createSession()` returns a valid session ID
- `sendPrompt()` collects streamed text and returns it as a single string
- Tool approval requests are auto-approved in trust-all mode
- Timeout triggers cancellation and returns `timedOut: true`
- `terminateSession()` cleans up the child process

## Metadata

- **Complexity**: Medium
- **Parent Task**: `kiro-acp-backend.code-task.md`
- **Depends On**: None
