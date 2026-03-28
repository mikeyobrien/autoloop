# Memory Reference

Loop memory is a persistent, append-only store that carries learnings, preferences, and metadata across iterations and runs. It lives in `.miniloop/memory.jsonl` and is injected into each iteration prompt within a configurable character budget.

Memory is **durable** — entries survive across runs. It is also **soft-deletable** — entries are never physically removed; instead, a tombstone entry marks the target as inactive.

## File format

Memory is JSONL (one JSON object per line). Each line is a self-contained entry with an `id` and `type` field.

### Entry types

There are four entry types:

**Learning** — a durable lesson discovered during a loop run.

```json
{"id": "mem-1", "type": "learning", "text": "Do not document task.progress as a normal emit example", "source": "manual", "created": "2026-03-27T01:00:19Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (`mem-N`). |
| `type` | string | Always `"learning"`. |
| `text` | string | The lesson content. |
| `source` | string | Origin — `"manual"` for CLI-added entries. |
| `created` | string | ISO 8601 UTC timestamp. |

**Preference** — a categorized behavioral preference.

```json
{"id": "mem-2", "type": "preference", "category": "Workflow", "text": "Always run tests before emitting review.ready", "created": "2026-03-27T02:00:00Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (`mem-N`). |
| `type` | string | Always `"preference"`. |
| `category` | string | Grouping label (e.g. `"Workflow"`, `"Style"`). |
| `text` | string | The preference content. |
| `created` | string | ISO 8601 UTC timestamp. |

**Meta** — arbitrary key-value metadata.

```json
{"id": "meta-1", "type": "meta", "key": "smoke_iteration", "value": "2", "created": "2026-03-27T03:00:00Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (`meta-N`). |
| `type` | string | Always `"meta"`. |
| `key` | string | Metadata key. |
| `value` | string | Metadata value. |
| `created` | string | ISO 8601 UTC timestamp. |

**Tombstone** — soft-deletes a previous entry.

```json
{"id": "ts-1", "type": "tombstone", "target_id": "mem-2", "reason": "no longer applicable", "created": "2026-03-27T04:00:00Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (`ts-N`). |
| `type` | string | Always `"tombstone"`. |
| `target_id` | string | The `id` of the entry being removed. |
| `reason` | string | Why the entry was removed. |
| `created` | string | ISO 8601 UTC timestamp. |

## ID generation

IDs are auto-assigned based on line count:

- Learnings, preferences: `mem-N` where N is the next line number.
- Meta entries: `meta-N`.
- Tombstones: `ts-N`.

IDs are unique within the file and are used for tombstone targeting and deduplication.

## Materialization

Before memory is rendered into the prompt, it goes through **materialization** — a process that produces a clean, deduplicated view from the raw append-only log.

Materialization works in reverse chronological order:

1. Read all lines from the JSONL file.
2. Walk entries from newest to oldest.
3. For each tombstone, record its `target_id` as inactive.
4. For each non-tombstone entry, skip it if its `id` has been tombstoned or already seen.
5. For meta entries, additionally deduplicate by `key` — only the most recent value for each key is kept.
6. Collect surviving entries into three buckets: preferences, learnings, meta.

The result is a materialized view with no duplicates and no tombstoned entries, ordered oldest-first within each category.

## Prompt injection

Materialized memory is rendered as a text block and injected into the iteration prompt between the objective and the topology section. The rendered format groups entries by category:

```
Loop memory:
Preferences:
- [mem-2] [Workflow] Always run tests before emitting review.ready
Learnings:
- [mem-1] (manual) Do not document task.progress as a normal emit example
Meta:
- [meta-1] smoke_iteration: 2
```

Empty categories are omitted. If no entries survive materialization, the memory block is omitted entirely.

Normal iteration prompts and hyperagent review prompts also include a small **Context pressure** summary derived from the same materialized memory. That summary reports rendered memory size vs budget, active entry counts by category, and whether the prompt memory is currently being truncated.

### Budget truncation

The rendered text is truncated to `memory.prompt_budget_chars` characters (default: **8000**). If the text exceeds the budget, it is sliced at the character boundary, `\n...` is appended, and a footer reports the active entry counts plus rendered-vs-budget size so prompt pressure is visible inside the clipped memory block itself. A budget of `0` disables truncation. When truncation happens, the separate **Context pressure** block still reports the full rendered size so the agent and hyperagent can tell that prompt memory is under pressure even though the visible memory block has been clipped.

## CLI commands

All memory mutations happen through the `miniloops` CLI (or the loop's event tool, which delegates to the same binary).

### Add a learning

```sh
miniloops memory add learning "durable lesson text"
```

The `source` field is set to `"manual"` for CLI-added entries.

If the new entry pushes rendered memory over `memory.prompt_budget_chars`, the CLI prints a warning with the rendered size and budget so operators can prune memory or raise the budget before the next prompt silently clips it.

### Add a preference

```sh
miniloops memory add preference <category> "preference text"
```

The first argument after `preference` is the category label.

### Add a meta entry

```sh
miniloops memory add meta <key> "value text"
```

### Remove an entry

```sh
miniloops memory remove <id>
miniloops memory remove <id> "reason for removal"
```

Appends a tombstone targeting `<id>`. If no reason is provided, the reason defaults to `"manual"`.

If the target ID is missing or already inactive, the CLI prints a warning instead of appending a no-op tombstone.

### List memory

```sh
miniloops memory list
```

Prints the materialized memory (same format as prompt injection, without budget truncation). Rendered entries include their stable IDs so `memory remove` is directly actionable.

### Memory status

```sh
miniloops memory status
```

Prints the rendered size, configured budget, over/under-budget percentage, and active counts for learnings, preferences, and meta entries.

### Find memory entries

```sh
miniloops memory find "routing lag"
```

Searches active entries across IDs, categories, text, sources, keys, and values, then prints matching entries with their IDs.

### Inspect memory

```sh
miniloops inspect memory --format md     # rendered text
miniloops inspect memory --format json   # raw JSONL content
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `memory.prompt_budget_chars` | int | `8000` | Character budget for prompt injection. `0` disables truncation. |
| `core.memory_file` | string | `".miniloop/memory.jsonl"` | Path to the memory file, relative to the project directory. |

## Environment

The harness exports `MINILOOPS_MEMORY_FILE` into the backend process environment, containing the absolute path to the memory file. This allows subprocesses and scripts to read or append to memory directly.

## JSON encoding

Memory values are stored with Unicode escape sequences for characters that would break JSONL parsing:

| Character | Escape |
|-----------|--------|
| `\` | `\u005c` |
| `"` | `\u0022` |
| newline | `\u000a` |
| carriage return | `\u000d` |
| tab | `\u0009` |

Values are decoded back to their original form when read.
