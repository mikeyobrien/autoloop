---
name: autoloop-memory
description: Persist and recall Autoloop loop memory — add learnings and preferences, list and find entries, and render memory into prompts. Use when the user asks to remember something across loop runs, inspect loop memory, or configure a memory plugin.
argument-hint: "[add|list|find|render|status|remove] [args...]"
---

# Autoloop Memory

Loop memory is the durable store a loop reads into each iteration prompt. The default plugin is `jsonl` (`.autoloop/memory.jsonl`). A loop uses memory without forking core: pick a plugin with `memory.kind` in `autoloops.toml`.

Parse `$ARGUMENTS` to choose a verb. If none, list memory.

## Verbs

```bash
# Persist
autoloop memory add learning "insight the next iteration should keep"
autoloop memory add preference Workflow "Always run tests before review.ready"
autoloop memory add meta smoke_iteration "2"

# Recall
autoloop memory list
autoloop memory find "pattern"
autoloop memory status

# Prompt-shaped render (same text the harness injects, no budget)
autoloop memory list

# Remove (tombstone; append-only)
autoloop memory remove <id>
```

`autoloop inspect memory` shows the same rendered block (`--format md`) or raw store (`--format json`).

## Default jsonl store

Unless `memory.kind` is set, Autoloop uses the built-in `jsonl` plugin:

- Path: `AUTOLOOP_MEMORY_FILE` or `core.memory_file` (default `.autoloop/memory.jsonl`)
- Entries: learning, preference, meta, tombstone
- Prompt injection is truncated to `memory.prompt_budget_chars` (default 8000)

`file` is a second built-in plugin with the same jsonl file store. Register additional plugins in process (tests or a host) and select them with `memory.kind` — harness internals stay unchanged.

```toml
[memory]
kind = "jsonl"
prompt_budget_chars = 8000
```

## When to write memory

- **learning** — a durable lesson discovered during a run
- **preference** — a categorized behavioral rule (always project-scoped)
- **meta** — a small key/value the next iteration should see

Do not invent a second memory product. Use these verbs against the configured plugin.
