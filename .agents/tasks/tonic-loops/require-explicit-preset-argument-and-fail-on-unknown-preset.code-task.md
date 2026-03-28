# Task: Require Explicit Preset Argument And Fail On Unknown Preset

## Description
Change the `run` CLI so the user must provide an explicit preset argument, and fail early when that preset/path does not resolve. Do not silently reinterpret an unknown preset as prompt text and fall back to the repo-root autocode loop.

## Background
Today `src/main.tn` parses `miniloops run [project-dir] [prompt...]` using `looks_like_project_dir/1`. If the first positional argument is not an existing directory with `miniloops.toml` (or `miniloops.conf`), it is treated as prompt text and the project directory falls back to `.`.

In this repo, `.` is the root autocode preset, so a command like:

```bash
miniloops run autoqa "qa recent changes"
```

can silently degrade into:
- project_dir = `.`
- prompt = `"autoqa qa recent changes"`
- active loop = repo-root autocode

That is the wrong failure mode. If the user intended to choose a preset and that preset did not resolve, the CLI should stop immediately with a clear error.

This task should make preset selection explicit for `run`. The first required positional after `run` should be the preset/path argument. If it is missing or invalid, the command should fail with a helpful message. Do not keep the current fallback-to-autocode behavior for this case.

## Reference Documentation
**Required:**
- Design: `src/main.tn`
- Design: `src/harness.tn`
- Design: `src/chains.tn`
- Design: `docs/cli.md`
- Design: `README.md`
- Design: `docs/creating-presets.md`
- Design: `examples/autocode/README.md`
- Design: `examples/autoqa/README.md`

**Additional References (if relevant to this task):**
- `docs/auto-workflows.md`
- `miniloops.toml`
- `examples/autocode/miniloops.toml`
- `examples/autoqa/miniloops.toml`

**Note:** You MUST inspect the current `run` argument parser and all places that document or assume the current optional-project-dir behavior before implementation. Keep the CLI behavior explicit and fail-closed.

## Technical Requirements
1. Change the `run` CLI contract so a preset/path argument is required.
2. Stop treating the first non-flag positional argument as prompt text when no valid preset/path was resolved.
3. If the user omits the preset argument, print a clear usage error and exit non-zero.
4. If the user provides a preset/path argument that does not resolve to a valid preset directory, print a clear resolution error and exit non-zero.
5. Keep support for explicit preset directories/paths that actually exist and contain miniloops config.
6. If built-in preset-name resolution exists or is added as part of the implementation, unknown preset names must also fail early with a clear error rather than falling through to autocode.
7. Update help text and docs so `run` no longer advertises optional implicit fallback behavior.
8. Update examples to show the explicit preset/path argument in `run` usage.
9. Add focused validation for the failure modes that caused this bug.
10. Validate with `tonic check .`.

## Dependencies
- Existing CLI parsing and usage output in `src/main.tn`
- Existing project/preset resolution logic in `src/main.tn` and `src/chains.tn`
- Existing run flow in `src/harness.tn`
- Current CLI and preset docs in `docs/cli.md`, `README.md`, and `docs/creating-presets.md`

## Implementation Approach
1. Audit the current `run` parser in `src/main.tn`, especially:
   - `runtime_argv/1`
   - `parse_run_args/1`
   - `looks_like_project_dir/1`
   - `print_usage/0`
2. Introduce an explicit required preset/path positional for `run`.
3. Add a clear resolver that distinguishes:
   - valid explicit path/preset
   - missing preset argument
   - invalid preset/path
4. Remove the code path where an invalid first positional becomes prompt text with `project_dir = "."`.
5. Update usage/help text and CLI docs to reflect the new required argument.
6. Update examples in README/docs to use the explicit preset/path form.
7. Add focused tests or reproducible checks for:
   - missing preset argument
   - invalid preset argument
   - valid explicit preset/path
8. Re-run `tonic check .`.

## Acceptance Criteria

1. **Missing Preset Fails Early**
   - Given a user runs `miniloops run` without a preset/path argument
   - When the CLI parses the command
   - Then it prints a clear usage error and exits non-zero

2. **Unknown Preset Does Not Fall Back To Autocode**
   - Given a user runs `miniloops run autoqaa "qa recent changes"`
   - When `autoqaa` does not resolve
   - Then the CLI prints a clear preset-resolution error and exits non-zero
   - And it does not start the repo-root autocode loop

3. **Invalid First Positional Is Not Reinterpreted As Prompt**
   - Given a user provides a first positional argument intended as preset/path that does not resolve
   - When the parser handles the command
   - Then that argument is not silently reclassified as prompt text

4. **Valid Explicit Preset Path Still Works**
   - Given a user runs `miniloops run examples/autoqa "qa recent changes"`
   - When the path resolves to a valid preset directory
   - Then the run starts successfully with that preset

5. **Help Text Matches The New Contract**
   - Given a user runs `miniloops --help`
   - When usage text is printed
   - Then `run` is documented with a required preset/path argument rather than optional implicit fallback behavior

6. **Docs No Longer Suggest Silent Defaulting**
   - Given the updated README and CLI docs
   - When a reader looks up how `run` works
   - Then they can see that preset/path selection is explicit and required

7. **Validation Passes**
   - Given the repo after the change
   - When `tonic check .` is run
   - Then it succeeds without errors

## Metadata
- **Complexity**: Medium
- **Labels**: miniloops, cli, presets, fail-closed, autocode, autoqa, argument-parsing
- **Required Skills**: CLI design, Tonic app development, argument parsing, UX for failure modes, documentation maintenance
