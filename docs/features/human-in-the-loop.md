# Human-in-the-loop (ask / respond)

Sometimes an agent needs a human decision before it can proceed. autoloop is
turn-based, so HITL maps cleanly to *between-iteration* blocking: an agent emits
a reserved **ask** event, the loop pauses until an operator responds (or a
timeout elapses), and the answer is injected into the next iteration's prompt.

This lets an external supervisor — a human at the CLI, or another tool like
ralph relaying a chat reply — drive HITL over the subprocess engine without any
mid-turn hook.

## Asking

An agent (or role prompt) emits the ask event with the question as the payload:

```bash
autoloop emit human.ask "Which database should I migrate to, Postgres or MySQL?"
```

The harness then:

1. journals `ask.pending` (with a `question_id` + the question),
2. emits an `ask.pending` event on the `--events` stream, and
3. **blocks** until a matching response arrives or `ask_timeout` elapses.

The CLI prints how to answer:

```
[ask] waiting for a human response (id=ask_<run-id>_3): Which database…?
      respond with: autoloop control respond <run-id> ask_<run-id>_3 "<answer>"
```

## Responding

An operator (or supervisor) delivers the answer via the control channel:

```bash
autoloop control respond <run-id> <question-id> "Use Postgres"
```

The harness records `ask.answered` and injects the answer into the next prompt
as operator guidance, then continues. If no one responds within `ask_timeout`,
it records `ask.timeout` and proceeds without an answer.

## Configuration

| Key | Default | Meaning |
|-----|---------|---------|
| `event_loop.ask_event` | `human.ask` | The event that triggers a blocking ask. Set to `""` to disable HITL. |
| `event_loop.ask_timeout` | `5m` | How long to wait for a response (`"3d"`/`"90m"` or ms). |
| `event_loop.ask_poll_ms` | `500` | How often to poll for a response while blocked. |

## For external supervisors

A parent process driving `autoloop run` can implement HITL by watching the
journal (or the `--events` stream) for `ask.pending`, relaying the question to a
human, and writing the answer back with `autoloop control respond`. The
`respond` request is keyed by `question_id`, so it reaches exactly the turn that
asked. Ctrl-C / abort cancels a pending ask cleanly.
