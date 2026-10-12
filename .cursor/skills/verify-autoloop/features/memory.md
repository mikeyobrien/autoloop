# Memory

Memory lets an operator store a learning in the project, list it, search it, and remove it.

## Sub-features

- `memory-add` stores a manual learning and prints `stored learning`.
- `memory-list` shows that learning with an id.
- `memory-find` returns the learning for a matching word and an explicit miss for an unknown word.
- `memory-remove` tombstones the learning so a later list no longer shows it.

## How to get to it (user POV)

- Run `autoloop memory add learning <text>`.
- Run `autoloop memory list`.
- Run `autoloop memory find <pattern>`.
- Run `autoloop memory remove <id>`.

## Driving it with control-autoloop

Preconditions:

- `init` has completed and `doctor` printed `"ok": true`.
- `memory list` does not already contain `Quarterly plan uses a draft budget`.

- **Add a learning.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory add learning "Quarterly plan uses a draft budget"`. Exit code `0`. Stdout contains `stored learning`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/memory/add.txt`.
- **List it.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory list`. Exit code `0`. Stdout contains `Loop memory:`, `Learnings:`, and `[mem-1] (manual) Quarterly plan uses a draft budget`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/memory/list.txt`.
- **Find a match.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory find budget`. Exit code `0`. Stdout contains `mem-1: learning (manual) Quarterly plan uses a draft budget`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/memory/find.txt`.
- **Find a miss.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory find volcano`. Exit code `0`. Stdout is `No active memory entries matching \`volcano\`.`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/memory/miss.txt`.
- **Remove it.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory remove mem-1`. Exit code `0`. Stdout contains `removed mem-1`.
- **Confirm removal.** Run `node .cursor/skills/verify-autoloop/scripts/control-autoloop.mjs cli -- memory list` again. Exit code `0`. Stdout does not contain `Quarterly plan uses a draft budget`. Save stdout to `$AUTOLOOP_VERIFY_ROOT/evidence/memory/removed.txt`.

## Gotchas

- Without `AUTOLOOP_STATE_DIR`, `memory add learning` writes the project memory file `.autoloop/memory.jsonl`. The harness does not set `AUTOLOOP_STATE_DIR`.
- The first learning in an empty project is `mem-1`. Do not hard-code that id if the project already has memory entries; read it from `memory list`.
- `memory find` exits `0` for both a hit and a miss. The miss string is the proof of the empty search.
- `memory list` prints an empty body when nothing is active. That empty body is the post-remove proof.
