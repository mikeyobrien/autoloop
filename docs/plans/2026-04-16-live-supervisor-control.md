# Live Supervisor Control Plane (MVP)

Status: implemented — see follow-ups at the bottom.
Date: 2026-04-16
Related:
- `docs/plans/2026-04-04-autoloops-ts-platform-strategy.md`
- `docs/plans/2026-04-04-autoloops-ts-loop-ops-backlog.md`

Purpose: Give autoloop a backend-neutral, durable substrate for **live** operator control of active runs. This unblocks Kiro ACP now (which has a real interrupt primitive) while preserving a clean abstraction that other adapters — Pi, Claude live-session, future Kiro extensions, Hermes/Grandpa supervisors — can plug into without inventing parallel conventions.

---

## Motivation

Today operators can inject `operator.guidance` into the journal, but a loop that is mid-turn on a 5+ minute backend call ignores guidance until the next iteration naturally starts. There is no backend-neutral way to say *"pick up guidance now"*, *"abort the current turn"*, or even *"show me which live operations this run currently supports"*. Each backend has its own notion of interruption (ACP cancel, Pi process kill, future Claude `signal`) and none of them are reachable from outside the autoloop parent process.

We want:
- A single operator surface: `autoloop control <verb> <run-id>`.
- Durable, file-backed control semantics that survive parent-process restarts and work across worktrees/chains the same way journals do.
- Backend adapters that **publish** which live verbs they support, so the operator can see whether `interrupt` will actually interrupt or only queue.
- A path to extend — future Claude live sessions, richer Kiro controls, or Pi with a real session manager should slot in by implementing the same capability/handler contract.

---

## Non-goals (explicit)

- Not a full Grandpa/Hermes supervisor — this is the *substrate* a supervisor would use.
- No daemon process. Control is file/journal-backed; the loop polls its own control directory between iterations and the backend adapter (when capable) watches for high-priority control on a side channel.
- Not an RPC boundary. No HTTP/socket server in this MVP.
- No second source of truth: journal remains canonical for events. The control directory holds durable **requests** and backends publish their own **capabilities**; both are derivative and rebuildable.

---

## Design

### Control channel: durable, run-scoped files

Every run already has a run-scoped state tree — either `.autoloop/runs/<run-id>/`, or in worktree mode the per-worktree `.autoloop/` inside the worktree checkout. We add **one new subdirectory** per run:

```
<run-state-dir>/control/
    capabilities.json        # last-known backend capabilities (written by harness)
    requests.jsonl           # append-only stream of control requests
    status.jsonl             # append-only stream of control acknowledgements
```

The existing `registryFile` is unchanged. Consumers who want a fast live answer can read `capabilities.json` + the last status line; consumers who want history replay the JSONL files.

### Request shape

Every control request carries:

```jsonc
{
  "id": "ctl_<short>",
  "runId": "<run-id>",
  "requestedAt": "<iso-8601>",
  "verb": "interrupt" | "guide",
  "reason": "<operator-supplied free text, optional>",
  "payload": { /* verb-specific; see below */ }
}
```

`guide` payload: `{ "message": "<operator guidance>", "interrupt": true|false }`.
`interrupt` payload: `{}`.

### Status shape

```jsonc
{
  "id": "<request id>",
  "runId": "<run-id>",
  "verb": "<verb>",
  "state": "received" | "applied" | "rejected" | "ignored",
  "at": "<iso-8601>",
  "detail": "<optional human-readable>"
}
```

### Capabilities

Capabilities are a backend-neutral contract. An adapter answers: *"For this run, right now, can the supervisor do X?"* Verb set is deliberately small:

| Verb        | Meaning                                                                                        |
|-------------|------------------------------------------------------------------------------------------------|
| `guidance`  | Operator guidance is durably appended and *will be read* by the loop on the next iteration.   |
| `interrupt` | Backend can cancel the in-flight turn and return to the loop boundary early.                  |
| `inspect`   | Run-scoped state is rich enough that `control show` returns meaningful live state.            |

Every backend always supports `guidance` and `inspect` (because the journal is canonical). `interrupt` is the real differentiator. Capabilities are a `Record<verb, { supported: boolean; detail?: string }>`; adapters may add informational keys but the operator CLI only renders the known verbs plus "extras" at the end.

### Backend adapter contract

```ts
export interface LiveControlAdapter {
  readonly backend: string;                  // "kiro", "pi", etc.
  capabilities(): ControlCapabilities;       // static + runtime signal
  onRequest(request: ControlRequest): ControlAck;  // called by the polling hook
}
```

The harness installs one adapter per active loop, calls `publishCapabilities` at loop start, and drives the control polling loop between iterations. The adapter *may* also opt in to a high-priority side channel (worker-thread signal, pipe, etc.) — `onRequest` is invoked synchronously there too.

### Kiro ACP adapter (first real backend)

Kiro has a native cancel: `connection.cancel({ sessionId })` and we already wire a `signalInterrupt()` helper that kills the detached child process group. The Kiro adapter:

- Publishes `interrupt: supported` at loop start.
- On `interrupt` or on `guide { interrupt: true }`, calls `signalInterrupt()` on the bridge. The existing SIGTERM → SIGKILL fallback handles processes that ignore cancel.
- Writes the capability snapshot to `control/capabilities.json` on publish.

We do **not** attach an async watcher inside the worker thread for the MVP. Instead, the harness drains the control queue once per iteration boundary (before and after `iteration.finish`), and a small dispatcher invoked by the CLI **additionally** calls `signalInterrupt` via an out-of-band path — which we provide by letting the CLI write the request *and* send a POSIX signal when it can identify the parent pid from the registry.

Because `signalInterrupt` only affects the parent process, and the parent is identified by `pid` in `registry.jsonl`, the CLI signals the parent's pid with `SIGUSR1` when the user asks for an immediate interrupt. The parent's harness listens for `SIGUSR1`, drains control requests, and dispatches each to the registered adapter. Journal/registry remain canonical; `SIGUSR1` is just a poke.

### Pi adapter (abstraction-only placeholder)

Pi has no in-process cancel equivalent today. The Pi adapter reports:

```json
{
  "guidance": { "supported": true },
  "interrupt": { "supported": false, "detail": "pi backend has no in-flight cancel" },
  "inspect": { "supported": true }
}
```

`interrupt` requests are accepted, journaled as `control.request`, and immediately status-acked as `ignored`. This keeps Pi visible in the abstraction without pretending.

### CLI surface

```
autoloop control show <run-id>                  # one-line status + capabilities
autoloop control capabilities <run-id>          # capabilities only
autoloop control interrupt <run-id> [-m <reason>]
autoloop control guide <run-id> "<message>"     # durably append guidance + request interrupt
                                   [--no-interrupt]   # just append guidance
```

Rules:
- `guide` always appends `operator.guidance` to the journal (unchanged semantics). This is what the next iteration actually reads — the durable, canonical path.
- `guide` writes exactly **one** control request with verb `guide` whose payload carries an explicit `interrupt: boolean`. When `--no-interrupt` is not passed, `interrupt` is `true`; otherwise `false`. The adapter decides what to do with that flag:
  - The Kiro adapter treats `guide + interrupt:true` as "also cancel the current turn"; its ack is `applied` with a `guidance-driven` detail.
  - The Pi adapter accepts the guide durably (via the journal) and acks `applied` with a note that the interrupt component was ignored.
  We intentionally do **not** also emit a separate `interrupt` request from `guide`. One request is enough to describe operator intent, it keeps the status log single-threaded, and it avoids coordinating two acks for what is conceptually one action. Operators who want a pure interrupt use `autoloop control interrupt`.
- Partial run-id prefixes resolve through the existing merged-registry helper.
- All commands work from the project root or a worktree checkout, just like `autoloop loops`.

### Supervisor-signal flow (Kiro)

```
operator                    cli dispatch             parent harness            kiro worker
    │                           │                         │                         │
    │ control interrupt <run>   │                         │                         │
    ├──────────────────────────►│                         │                         │
    │     (cli writes request,  │                         │                         │
    │      looks up pid, sends  │                         │                         │
    │      SIGUSR1)             │                         │                         │
    │                           ├─signal─────────────────►│                         │
    │                           │                         │ drainControlRequests    │
    │                           │                         ├────────────────────────►│ signalInterrupt
    │                           │                         │                         │ (kills child pg)
    │                           │                         │ writes status.jsonl     │
    │                           │                         │                         │
    │ control show <run> ◄──────┤                    reads status.jsonl             │
    │                           │                    reads capabilities.json        │
```

---

## File map

New:
- `src/control/types.ts`
- `src/control/paths.ts`
- `src/control/capabilities.ts`
- `src/control/queue.ts`
- `src/control/dispatch.ts`
- `src/control/adapter.ts`
- `src/control/kiro-adapter.ts`
- `src/control/pi-adapter.ts`
- `src/control/render.ts`
- `src/commands/control.ts`
- `test/control/queue.test.ts`
- `test/control/kiro-adapter.test.ts`
- `test/integration/control-cli.test.ts`

Modified:
- `src/harness/index.ts` — install adapter at loop start; listen for `SIGUSR1`; drain after each iteration.
- `src/main.ts` + `src/usage.ts` — wire `control` command.
- `docs/plans/2026-04-04-autoloops-ts-loop-ops-backlog.md` — register the new surface.

---

## Acceptance

- `autoloop control show <run>` prints status + capabilities even when the parent process is idle (file-backed).
- `autoloop control interrupt <run>` against a Kiro run:
  - Writes a request to the control queue.
  - Sends `SIGUSR1` to the parent pid.
  - Parent handler invokes the Kiro adapter, which calls `signalInterrupt()` — the ACP child exits, the loop records `interrupted` via the existing path.
  - `status.jsonl` records `applied` with backend detail.
- `autoloop control guide <run> "message"`:
  - Appends `operator.guidance` to the journal.
  - Writes **one** `guide` control request with payload `{ message, interrupt: true }`. No separate `interrupt` request is emitted — the interrupt intent is an attribute of the guide request.
  - For a Kiro run, draining that request triggers the interrupt path and `status.jsonl` records `applied` with a `guidance-driven` detail. For a Pi run, the interrupt component is `ignored` while guidance is still durable.
- All existing tests pass.
- New tests cover: queue round-trip, Kiro adapter interrupt wiring, CLI dispatch end-to-end (with mock adapter), Pi adapter "limited" capability reporting.

---

## Future slices (out of scope here)

1. Richer capability catalog (`pause`, `resume`, `switch-agent`, `attach-mcp`) as adapters grow.
2. A reliable bidirectional worker-thread channel so Kiro can also pick up control without SIGUSR1.
3. Hermes/Grandpa supervisor built on top of this substrate.
4. Policy (rate limit operator interrupts per run, require reason strings, audit by operator identity).
5. HTTP/socket surface over the same capability contract.
