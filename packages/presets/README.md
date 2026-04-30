# @mobrienv/autoloop-presets

Bundled preset definitions for autoloop (data-only).

Each subdirectory under `presets/` is a self-contained preset — a directory
that autoloop recognizes as a project via its `autoloops.toml` and supporting
role / topology files. Presets are static configuration plus prompt fragments;
this package ships them as files only, no runtime code.

## Shape

```
presets/
  autocode/
    autoloops.toml      # preset-as-project config
    harness.md          # system prompt fragment + metadata
    topology.toml       # role graph (optional)
    roles/*.md          # per-role prompts (optional)
    README.md           # "Use when/after …" description surfaced by `autoloop list`
  …
```

## Consumption

`@mobrienv/autoloop-cli` resolves this package via `require.resolve` at runtime
to locate bundled presets. `@mobrienv/autoloop-core` helpers (`resolvePresetDir`,
`resolveBundledPresetDir`) fall back to this package's `presets/` directory when
no project-local or user-local preset is found.

Users override individual presets by dropping a same-named directory under
`$XDG_CONFIG_HOME/autoloop/presets/<name>/` — user presets win over bundled
ones during resolution.

## Adding a preset

1. Create `presets/<name>/` with at minimum `autoloops.toml` and `README.md`.
2. Add `<name>` to the built-in list in
   `packages/cli/src/chains/load.ts::listKnownPresets`.
3. Follow the "Use when/after …" convention in the README description so the
   preset-list test passes.
