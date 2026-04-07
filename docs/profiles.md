# Profiles

Profiles inject additional prompt fragments into specific roles at runtime without modifying the preset's topology files. They allow customizing role behavior per-repo or per-user while keeping the base preset generic.

## Scopes

A profile lives in one of two scopes, specified as `<scope>:<name>`:

| Scope | Directory | Example spec |
|-------|-----------|-------------|
| `repo` | `<workDir>/.autoloop/profiles/<name>/` | `repo:strict-review` |
| `user` | `~/.config/autoloops/profiles/<name>/` | `user:my-style` |

Repo-scoped profiles are checked into the project and shared with the team. User-scoped profiles are personal and apply across any project.

## Directory structure

Each profile contains subdirectories named after the presets it targets. Inside each preset directory, markdown files are named after the roles they extend:

```
.autoloop/profiles/strict-review/
  autocode/
    critic.md       # appended to the critic role prompt
    builder.md      # appended to the builder role prompt
  autodoc/
    checker.md      # appended to the checker role prompt
```

Only `.md` files are loaded. Files named after roles not present in the topology produce a warning but do not cause errors.

## Fragment resolution

When a loop starts (or reloads), the harness resolves profile fragments in order:

1. **Collect active profiles**: config defaults first, then CLI `--profile` flags (in order given).
2. **For each profile**: locate the profile directory, then look for a subdirectory matching the current preset name.
3. **For each `.md` file** in the preset subdirectory (sorted alphabetically): read the file content and append it to the matching role's prompt.
4. **Multiple profiles**: fragments from later profiles are appended after earlier ones, so later profiles take precedence in case of conflicting instructions.

If a profile directory does not exist, the harness throws an error. If a profile exists but has no subdirectory for the current preset, a warning is emitted and the profile is skipped.

## Activating profiles

### CLI flags

```bash
autoloops run --profile repo:strict-review --profile user:my-style <preset-dir>
```

The `--profile` flag is repeatable. Profiles are applied in the order specified.

### Config defaults

Set default profiles in `autoloops.toml` so they activate on every run without CLI flags:

```toml
[profiles]
default = "repo:strict-review, user:my-style"
```

The value is a comma-separated list of profile specs. These are prepended to any CLI `--profile` values.

### Suppressing defaults

To run without config-defined default profiles:

```bash
autoloops run --no-default-profiles <preset-dir>
```

This suppresses only the config defaults. Explicit `--profile` flags still apply.

## Inspecting profiles

```bash
autoloops inspect profiles
```

This shows:
- Config default profiles (from `profiles.default`)
- Active profiles and their resolved fragments (first line of each fragment previewed)
- Any warnings (missing preset directories, unknown role names)

## How fragments are applied

Fragments are concatenated to the role's base prompt with a newline separator. The role's original prompt is preserved — fragments only append. When multiple profiles contribute fragments for the same role, they are joined in profile order.

```
<original role prompt>\n<profile-1 fragment>\n<profile-2 fragment>
```

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `profiles.default` | `""` | Comma-separated list of profile specs to activate by default |
