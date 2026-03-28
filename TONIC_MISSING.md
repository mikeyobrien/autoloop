# TONIC_MISSING.md

Track missing Tonic stdlib capabilities that forced local workarounds.

For each entry, include:
- date
- missing stdlib capability
- where the workaround was added
- the workaround used
- desired stdlib support
- status

Source annotations use the `# TONIC_MISSING: <capability>` comment convention. Place the annotation above the workaround site so it is discoverable via `grep -r "TONIC_MISSING:" src/`.

## Entries

### Regex

- **Date:** 2026-03-28
- **Missing capability:** `Regex` module — no native regular expression matching
- **Workaround location:** `src/topology.tn` (lines 350–410, `regex_match/2` and helpers)
- **Workaround:** Shells out to `grep -qE` via `System.run/1` with `LoopUtils.shell_quote` for safe argument escaping
- **Desired stdlib support:** Native `Regex.match?/2` function
- **Status:** Open
