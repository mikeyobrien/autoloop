# Memory Reference

Loop memory is a two-tier, append-only store that carries learnings, preferences, and metadata across iterations. It is split into **project memory** (durable, shared across runs) and **run memory** (ephemeral, per-run). Preferences are always project-scoped. Learnings and meta default to run-scoped but can be promoted to project memory.

Memory is **soft-deletable** — entries are never physically removed; instead, a tombstone entry marks the target as inactive.

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

## Two-tier scoping

Memory is split into two tiers:

| Tier | Path | Lifetime | Content |
|------|------|----------|---------|
| Project | `<workDir>/.autoloop/memory.jsonl` | Permanent | Preferences, promoted learnings |
| Run | `<stateDir>/memory.jsonl` | Per-run | Learnings (default), meta (always) |

**Project memory** is resolved via `AUTOLOOP_MEMORY_FILE` env or `core.memory_file` config. It persists across all runs.

**Run memory** is derived from `AUTOLOOP_STATE_DIR` (the per-run state directory). No new env var or config key is needed.

### Default scoping rules

| Command | Target Tier | Override |
|---------|-------------|----------|
| `memory add learning <text>` | Run | `--project` flag → Project |
| `memory add preference <cat> <text>` | Project | None (always project) |
| `memory add meta <key> <value>` | Run | None (always run) |
| `memory promote <id>` | Run → Project | N/A |
| `memory remove <id>` | Whichever tier contains it | N/A |

### Fallback behavior

When `AUTOLOOP_STATE_DIR` is not set (e.g. running outside a loop context), all writes fall back to project memory. This preserves backward compatibility.

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

Materialized memory is rendered as a text block and injected into the iteration prompt between the objective and the topology section. The rendered format groups entries by tier and category:

```
Loop memory:
Project memory:
Preferences:
- [mem-1] [Workflow] Always run tests before emitting review.ready
Learnings:
- [mem-3] (promoted) Use .tsx for JSX files

Run memory:
Learnings:
- [mem-1] (manual) This task uses vitest for testing
Meta:
- [meta-1] smoke_iteration: 2
```

When run memory is empty, the "Run memory:" section is omitted. When project memory is empty, the "Project memory:" section is omitted. The "Loop memory:" header is always present if either tier has content.

Empty categories are omitted. If no entries survive materialization in either tier, the memory block is omitted entirely.

Normal iteration prompts and metareview review prompts also include a small **Context pressure** summary derived from the same materialized memory. That summary reports rendered memory size vs budget, active entry counts by tier and category (e.g. "2 project preferences, 10 run learnings, 2 run meta"), and whether the prompt memory is currently being truncated.

### Budget truncation

The rendered text is truncated to `memory.prompt_budget_chars` characters (default: **8000**). The combined text renders project memory first, then run memory. Truncation drops lines from the bottom, so **run memory entries are dropped before project entries**. Within each tier, the existing drop order applies: meta → learnings → preferences (bottom to top).

## CLI commands

All memory mutations happen through the `autoloop` CLI (or the loop's event tool, which delegates to the same binary).

### Add a learning

```sh
autoloop memory add learning "durable lesson text"
autoloop memory add learning --project "lesson for all runs"
```

By default, learnings are written to **run memory**. Use `--project` to write to project memory instead. When `AUTOLOOP_STATE_DIR` is not set, learnings always go to project memory.

The `source` field is set to `"manual"` for CLI-added entries.

### Add a preference

```sh
autoloop memory add preference <category> "preference text"
```

The first argument after `preference` is the category label.

### Add a meta entry

```sh
autoloop memory add meta <key> "value text"
```

Meta entries are written to **run memory** by default. When `AUTOLOOP_STATE_DIR` is not set, they fall back to project memory.

### Remove an entry

```sh
autoloop memory remove <id>
autoloop memory remove <id> "reason for removal"
```

Appends a tombstone targeting `<id>`. If no reason is provided, the reason defaults to `"manual"`.

If the target ID is missing or already inactive, the CLI prints a warning instead of appending a no-op tombstone.

When `AUTOLOOP_STATE_DIR` is set, `remove` searches both run and project memory (run first).

### Promote a learning

```sh
autoloop memory promote <id>
```

Copies a run-scoped learning to project memory and tombstones the run copy. Only learnings can be promoted. Prints the new project-scoped ID. Requires `AUTOLOOP_STATE_DIR` to be set.

### List memory

```sh
autoloop memory list
```

Prints the materialized memory (same format as prompt injection, without budget truncation). When `AUTOLOOP_STATE_DIR` is set, shows both project and run memory. Rendered entries include their stable IDs so `memory remove` is directly actionable.

### Memory status

```sh
autoloop memory status
```

Prints the rendered size, configured budget, over/under-budget percentage, and active counts for learnings, preferences, and meta entries.

### Find memory entries

```sh
autoloop memory find "routing lag"
```

Searches active entries across IDs, categories, text, sources, keys, and values, then prints matching entries with their IDs. When `AUTOLOOP_STATE_DIR` is set, searches both project and run memory.

### Inspect memory

```sh
autoloop inspect memory --format md     # rendered text
autoloop inspect memory --format json   # raw JSONL content
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `memory.prompt_budget_chars` | int | `8000` | Character budget for prompt injection. `0` disables truncation. |
| `core.memory_file` | string | `".autoloop/memory.jsonl"` | Path to the memory file, relative to the project directory. |

## Environment

The harness exports `AUTOLOOP_MEMORY_FILE` into the backend process environment, containing the absolute path to the memory file. This allows subprocesses and scripts to read or append to memory directly.

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
