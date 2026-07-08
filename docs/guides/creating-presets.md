# Creating Custom Presets

A preset is a self-contained loop definition that lives in a single directory. All shipped presets follow the same structure — there is nothing special about the built-in `auto*` family that a custom preset cannot do.

## Directory structure

A preset directory contains four kinds of files:

```
my-preset/
├── autoloops.toml    # Loop configuration (required)
├── topology.toml     # Role deck and handoff graph (required for multi-role loops)
├── harness.md        # Shared instructions loaded every iteration (required)
├── README.md         # Human-facing description (optional)
└── roles/            # Role prompt files referenced by topology.toml
    ├── first-role.md
    ├── second-role.md
    └── ...
```

The directory can live anywhere. Built-in presets live under `presets/<name>/`; custom presets just need a path that `autoloop run` can resolve.

## Step 1: Define the topology

`topology.toml` declares roles, their allowed events, and how events route between roles.

```toml
name = "my-preset"
completion = "task.complete"

[[role]]
id = "analyst"
emits = ["analysis.done", "task.complete"]
prompt_file = "roles/analyst.md"

[[role]]
id = "implementer"
emits = ["impl.ready", "impl.blocked"]
prompt_file = "roles/implementer.md"

[[role]]
id = "verifier"
emits = ["verified", "rejected"]
prompt_file = "roles/verifier.md"

[handoff]
"loop.start" = ["analyst"]
"analysis.done" = ["implementer"]
"impl.ready" = ["verifier"]
"impl.blocked" = ["analyst"]
"verified" = ["analyst"]
"rejected" = ["implementer"]
```

**Key rules:**

- Every role needs an `id`, an `emits` list, and either `prompt_file` or `prompt` (inline string) — that flexibility applies to **directory presets**. A [single-file preset](#single-file-presets) supports inline `prompt` only.
- `prompt_file` paths are relative to the preset directory.
- The `[handoff]` section maps events to the roles that should handle them. An event not listed in the handoff map causes all roles to be suggested (no routing preference).
- `completion` sets the topology-level completion event. It can also be set in `autoloops.toml` via `event_loop.completion_event` — the topology value takes precedence, with the config value used as a fallback.
- `"loop.start"` is the synthetic event emitted at iteration 1. Use it to define which role kicks off the loop.

See [`docs/topology.md`](../reference/topology.md) for the full reference.

## Step 2: Write role prompts

Each role gets a markdown file in `roles/`. A role prompt should:

1. **Open with identity** — "You are the analyst." This anchors the model.
2. **State what the role does NOT do** — "Do not implement. Do not verify." Boundary-setting prevents role drift.
3. **Define the job** — Numbered steps for what the role does on every activation.
4. **Specify when to emit each event** — Be explicit about the conditions for each event in the role's `emits` list.
5. **List rules** — Constraints, defaults, and fail-closed behaviors.

Example (`roles/analyst.md`):

```markdown
You are the analyst.

Do not implement. Do not verify.

Your job:
1. Read the objective and current state.
2. Break the problem into a prioritized list of tasks.
3. Hand the next task to the implementer.

On every activation:
- Re-read shared working files before deciding the next task.

Emit:
- `analysis.done` with the next task description.
- `task.complete` only when all tasks are done and verified.

Rules:
- One active task at a time.
- Be specific enough that the implementer can act without guessing.
```

**Inline prompts** are also supported — set `prompt = "You are the analyst."` directly in `topology.toml` instead of using `prompt_file`. This works for simple roles but markdown files are better for anything non-trivial.

## Step 3: Write the harness instructions

`harness.md` contains shared rules that are injected into every iteration regardless of which role is active. Use it for:

- Naming the loop's purpose.
- Declaring shared working files and their roles.
- Setting global constraints (one task at a time, fresh context every iteration, etc.).
- Requiring use of the event tool for handoffs.
- Listing state file contracts.

Example:

```markdown
This is a custom analysis-and-implementation loop.

Global rules:
- Shared working files are the source of truth: `{{STATE_DIR}}/tasks.md`, `{{STATE_DIR}}/progress.md`.
- One task at a time. Do not start the next task before the current one is verified.
- Use the event tool instead of prose-only handoffs.
- Fresh context every iteration: re-read shared working files before acting.
- Use `{{TOOL_PATH}} memory add learning ...` for durable learnings.
- Do not invent extra phases. Stay inside analyst → implementer → verifier.

State files:
- `{{STATE_DIR}}/tasks.md` — task list with priorities and status.
- `{{STATE_DIR}}/progress.md` — current task, verification results, what the next role should do.
```

The `harness.instructions_file` key in `autoloops.toml` points to this file. It defaults to `harness.md`.

### Template placeholders

Use `{{STATE_DIR}}` and `{{TOOL_PATH}}` in harness instructions, role prompts, and metareview prompts instead of hardcoding `.autoloop/` paths. The harness expands these placeholders at load time before the prompt reaches the model.

| Placeholder | Expands to | Example |
|---|---|---|
| `{{STATE_DIR}}` | The loop's state directory (e.g. `.autoloop`) | `{{STATE_DIR}}/progress.md` |
| `{{TOOL_PATH}}` | The full event tool path (e.g. `./.autoloop/autoloops`) | `{{TOOL_PATH}} emit review.ready "done"` |
| `{{PRESET_DIR}}` | Absolute path to the preset/config dir (holds `roles/`, `scripts/`, `hooks/`) | `sh {{PRESET_DIR}}/scripts/okf-init.sh` |

`{{PRESET_DIR}}` lets a role or hook reference preset-bundled files by path — e.g. a bootstrap script the loop runs before any scripts have been copied into the work dir. The same placeholders are also expanded in the `hooks.*` commands (`pre_run`, `pre_iteration`, `post_iteration`, `post_run`), so a hook can invoke a preset-bundled script (e.g. a deterministic `pre_run` bootstrap) without hardcoding paths.

**Why placeholders?** The concrete state directory can vary — worktrees, chains, and nested loops all change the path. Placeholders let the harness inject the correct path at runtime so presets stay portable.

**Important:** Raw `.autoloop/` paths in prompt text are not supported and will cause a load error. Always use `{{STATE_DIR}}` and `{{TOOL_PATH}}` placeholders.

## Step 4: Configure the loop

`autoloops.toml` sets iteration limits, backend, completion conditions, and memory/review settings.

```toml
event_loop.max_iterations = 100
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = ["verified"]

backend.kind = "pi"
backend.command = "pi"
backend.timeout_ms = 3000000

review.enabled = true
review.timeout_ms = 300000

memory.prompt_budget_chars = 8000
harness.instructions_file = "harness.md"

core.state_dir = ".autoloop"
core.journal_file = ".autoloop/journal.jsonl"
core.memory_file = ".autoloop/memory.jsonl"
```

**Key settings:**

- `event_loop.required_events` — events that must have been emitted at least once before `task.complete` is accepted. Use this to enforce quality gates (e.g., require a review pass before completion).
- `event_loop.completion_promise` — fallback string the model can output as plain text to signal completion when the event tool is unavailable.
- `review.enabled` — enables the metareview review loop. See [`docs/metareview.md`](../reference/metareview.md).
- `backend.kind` — `"pi"` for the Pi adapter (production), `"command"` for custom/mock backends.

See [`docs/configuration.md`](../reference/configuration.md) for the full key reference.

## Step 5: Run the preset

```bash
# From the repo root
node bin/autoloop run path/to/my-preset "Your objective here"

# Built-in presets can use their bundled name
autoloop run autocode "Your objective here"

# Explicit flag form for built-in names or custom dirs
autoloop run --preset autocode "Your objective here"
autoloop run --preset path/to/my-preset "Your objective here"

# Override backend for a one-off run
autoloop run -b claude --preset autocode "Your objective here"
```

`run` loads `autoloops.toml`, `topology.toml`, and `harness.md` from the selected preset directory. Built-in presets resolve by name through `presets/<name>/`; custom presets still use a directory path.

## Registering a preset in chains

To use a custom preset in chain compositions, the chain step name must resolve to the preset directory. Built-in presets resolve via `presets/<name>/`. For custom presets, use the directory path as the step name:

```toml
# chains.toml
[[chain]]
name = "my-pipeline"
steps = ["autocode", "path/to/my-preset", "autotest"]
```

Or compose ad hoc on the command line:

```bash
autoloop run . --chain autocode,path/to/my-preset,autotest
```

## Design patterns

### Linear pipeline

Roles flow in one direction. Each role hands off to the next, and the last role can either complete or cycle back to the first.

```
analyst → implementer → verifier → analyst (cycle) or task.complete
```

This is the most common pattern — used by autocode, autodoc, autosec, and most presets.

### Rejection loop

A verifier or critic can reject work back to the producer, creating a tighten-until-correct cycle.

```toml
[handoff]
"impl.ready" = ["verifier"]
"rejected" = ["implementer"]    # bounces back
"verified" = ["analyst"]        # advances
```

### Blocked escalation

When a role cannot proceed, it emits a `.blocked` event that routes to a role that can replan or unblock.

```toml
[handoff]
"impl.blocked" = ["analyst"]    # analyst replans around the blocker
```

### Fan-back

Multiple events route to the same role, making it a convergence point. Reporters and summarizers often use this pattern.

```toml
[handoff]
"finding.confirmed" = ["hardener"]
"finding.dismissed" = ["reporter"]
"fix.applied" = ["reporter"]
"fix.blocked" = ["reporter"]
```

## Naming convention

The built-in family uses `auto` + single lowercase word (autocode, autofix, autosec). Custom presets are not required to follow this convention, but if you are contributing a preset to the project, use the `auto` prefix and a single word that answers "what does this loop do?"

## Checklist

Before running a new preset:

- [ ] Every event in every role's `emits` list appears in the `[handoff]` map (or you are OK with fallback-to-all routing).
- [ ] `"loop.start"` is mapped in the handoff to the role that kicks off the loop.
- [ ] `event_loop.completion_event` in config matches the completion event in at least one role's `emits`.
- [ ] If `event_loop.required_events` is set, the required events are reachable in the handoff graph.
- [ ] Role prompt files exist at the paths declared in `prompt_file`.
- [ ] `harness.md` exists (or `harness.instructions_file` points to the correct file).
- [ ] Shared working file names are consistent between `harness.md` and role prompts.
- [ ] Use `{{STATE_DIR}}` and `{{TOOL_PATH}}` placeholders instead of hardcoded `.autoloop/` paths in harness and role prompts.

## Single-file presets

Everything above describes a **directory preset**: `autoloops.toml` + `topology.toml` + `harness.md` + `roles/*.md`, spread across several files. For anything ad hoc, one-off, or machine-generated, autoloop also supports a **single-file preset** — one merged TOML document that carries both the config tables and the topology tables, with role prompts inlined.

**When to use which:**

- **Directory preset** — a preset you'll reuse, iterate on, and check into a repo. Long role prompts read and diff better as separate markdown files; `harness.md`/`README.md` give it a home.
- **Single-file preset** — a preset generated on the fly (e.g. by the `autoarchitect` workflow, which writes one for every run), sketched quickly at the command line, or handed to someone as a single file to copy-paste. No directory structure to scaffold, no `roles/` to keep in sync.

### Format

A single-file preset is one `.toml` file containing:

- The usual config tables: `[event_loop]`, `[backend]`, `[memory]`, `[core]`, `[hooks]`, `[review]`, etc. — same keys as `autoloops.toml`.
- The topology tables in the same document: top-level `name` and `completion`, `[[role]]` entries, `[handoff]`, and optional `[[gate]]` entries.

```toml
name = "autoreview"
completion = "task.complete"

[event_loop]
max_iterations = 25
completion_event = "task.complete"

[backend]
kind = "command"
command = "claude"
timeout_ms = 600000

[memory]
prompt_budget_chars = 4000

[[role]]
id = "planner"
prompt = "You are the planner. Break the objective into review targets."
emits = ["targets.ready"]

[[role]]
id = "reviewer"
prompt = "You are the reviewer. Review each target and emit findings."
emits = ["review.ready", "review.blocked"]

[[role]]
id = "finalizer"
prompt = "You are the finalizer. Confirm the review is complete."
emits = ["task.complete"]

[handoff]
"loop.start" = ["planner"]
"targets.ready" = ["reviewer"]
"review.ready" = ["finalizer"]
"review.blocked" = ["planner"]
```

**`prompt_file` is not supported in single-file mode** — only inline `prompt = "..."` strings. `topology.validateTopology(topology, { singleFile: true })` flags any `prompt_file` reference in a single-file preset as a `prompt-file-in-single-file` warning, and both `autoloop preset promote` and the architect auto-chain refuse to run a preset with validation warnings.

### Creating one

```bash
autoloop init --single-file preset.toml
```

Scaffolds a builder → critic single-file preset at `preset.toml` with inline prompts, ready to run or edit.

### Running one

```bash
# Explicit, discoverable flag — hard-fails on a missing or non-.toml path
autoloop run --preset-file ./preset.toml "objective"

# -p/--preset also recognizes an explicit .toml path
autoloop run -p ./preset.toml "objective"

# The bare positional form works too
autoloop run ./preset.toml "objective"
```

`--preset-file` and `-p`/`--preset` differ slightly: `-p` is polymorphic — it accepts a bundled preset name, a preset directory, or a `.toml` file path, and falls through to bundled-preset resolution if the path doesn't otherwise resolve. `--preset-file` is a stricter, single-purpose contract — it always expects an existing `.toml` file and fails immediately with a clear error if the path isn't one, rather than silently trying other resolutions. Prefer `--preset-file` when scripting against a known file path.

### Promoting to a permanent preset

A single-file preset — hand-written, `init`-generated, or produced by the architect workflow — can graduate into a permanent named preset:

```bash
autoloop preset promote ./preset.toml myreview
```

This validates the source with `singleFile: true` and copies it into the user presets directory, after which `autoloop run myreview "..."` resolves it by name like any bundled preset.
