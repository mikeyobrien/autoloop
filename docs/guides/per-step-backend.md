# Per-step backend override in chains

`chains.toml` supports two forms for declaring the steps of a chain.

## Simple form (unchanged)

```toml
[[chain]]
name = "autocode-then-gate"
steps = ["autocode", "regression-gate"]
```

Every step uses the backend configured by the preset's own `autoloops.toml`,
optionally overridden by the CLI `-b` flag.

## Structured form with per-step backend

```toml
[[chain]]
name = "plan-then-build"

[[chain.step]]
preset = "autocode-planner"
backend = { args = ["--model", "anthropic/claude-opus-4", "--thinking", "high"] }

[[chain.step]]
preset = "autocode"
backend = { args = ["--model", "anthropic/claude-haiku-4"] }

[[chain.step]]
preset = "regression-gate"
# no backend override — uses the preset's autoloops.toml default
```

The motivating use case: run a **planner** step on a smarter/slower model and a
**builder** step on a faster/cheaper model.

## Allowed `backend` keys

Each step's `backend` table may contain any subset of:

| key           | meaning                                             |
|---------------|-----------------------------------------------------|
| `kind`        | `"command"` / `"pi"` / `"kiro"`                     |
| `command`     | backend executable name                             |
| `args`        | array of CLI args (e.g. `--model`, `--thinking`)    |
| `prompt_mode` | `"arg"` / `"stdin"` / `"acp"`                       |
| `timeout_ms`  | per-invocation timeout                              |

Unknown keys are rejected with a clear error.

## Precedence

Highest to lowest:

1. `[[chain.step]].backend` (this feature)
2. CLI `-b <backend>` flag
3. Preset `autoloops.toml` `[backend]` section

## Mixing forms

`steps = [...]` and `[[chain.step]]` **cannot** be used on the same `[[chain]]`
entry. Doing so raises a `cannot define both` error at load time. Different
chains in the same file may use different forms.

## Scope

Per-step backend override is supported for static chains declared in
`chains.toml`. Inline chains (`--chain foo,bar`) and dynamic chains spawned at
runtime via `DynamicChainSpec` are string-only and do not carry per-step
backends.
