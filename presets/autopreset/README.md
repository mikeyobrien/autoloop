# Autopreset

Generate a new autoloop preset from a rough idea.

Shape:
- designer — analyzes the idea, designs roles/events/handoffs
- generator — creates all preset files in `~/.config/autoloop/presets/<name>/`
- validator — checks structural validity of the generated preset
- finalizer — confirms the preset is complete and runnable

## Run

```bash
autoloop run autopreset "a loop that reviews PRs for security issues"
autoloop run autopreset "a loop that generates test cases from a spec"
```

The generated preset lands in `~/.config/autoloop/presets/<name>/` and is immediately runnable:

```bash
autoloop run <name> "your objective"
```

## What it generates

A complete preset directory:
- `autoloops.toml` — loop and backend config
- `topology.toml` — role deck and handoff graph
- `harness.md` — shared instructions
- `README.md` — description
- `roles/*.md` — one prompt file per role

## Design defaults

Unless the idea clearly calls for something different, the designer defaults to the standard planner→builder→critic→finalizer pattern. Custom roles and events are used when the idea warrants them.
