# Plan: Implement autoideas improvements

Based on the ideas-report.md produced by the autoideas loop, implement the actionable suggestions across 5 slices. Each slice is independently committable.

## Slice 1 — Fix config parser `=` splitting (Idea 4.1 + 4.2)

**Why first:** This is a silent data-loss bug. Most impactful correctness fix.

In `src/config.tn`:
- Replace `parse_assignment([key, value], rest, config)` with a `join_with_eq` approach that takes the first element as key and re-joins the rest with `=`.
- Add stderr warning for lines that can't be parsed (non-comment, non-blank, no `=`).

Files: `src/config.tn`

## Slice 2 — Add backend failure diagnostics (Ideas 5.1 + 5.2 + 5.3)

In `src/harness.tn`:
- Thread `output` through `stop_backend_failed(loop, iteration, output)` and `stop_backend_timeout(loop, iteration, output)`.
- Add `print_failure_diagnostic(output)` that prints last ~15 lines of output.
- Add `verbose_log` calls to both failure stop handlers.
- Add `output_tail` field to the journal `loop.stop` event for failures.
- Add `last_n_lines(text, n)` helper.

Files: `src/harness.tn`

## Slice 3 — Shell-based append_text (Idea 2.2)

Replace the O(n²) read-then-rewrite `append_text` with shell append in both `src/harness.tn` and `src/memory.tn`:
```
defp append_text(path, content) do
  System.run("printf '%s' " <> shell_quote(content) <> " >> " <> shell_quote(path))
end
```

Files: `src/harness.tn`, `src/memory.tn`

## Slice 4 — JSON helpers: json_field + json_object (Ideas 3.3 + 3.1)

In `src/harness.tn`:
- Add `json_field(key, value)` → `"\"key\": " <> json_string(value)`
- Add `json_field_raw(key, raw_value)` → `"\"key\": " <> raw_value`
- Add `json_object(pairs)` builder that joins key-value pairs with commas and wraps in `{}`
- Migrate all 16+ call sites in harness.tn to use the new helpers
- Add same helpers to `src/memory.tn` and migrate its 4 call sites

Files: `src/harness.tn`, `src/memory.tn`

## Slice 5 — Document hot-reload as intentional (Idea 6.3)

Add a comment to `reload_loop` explaining the design tradeoff.

Files: `src/harness.tn`

## Out of scope
- Idea 2.1 (native System.append_text) — requires runtime changes
- Idea 2.3 (batch journal writes) — complex refactor, low ROI after slice 3
- Idea 3.2 (RFC 8259 control chars) — nice-to-have, not critical
- Ideas 1.1/1.2/1.3 (shared modules) — larger refactor, does not fix bugs
- Idea 4.3 (full TOML) — explicitly non-goal
- Ideas 6.1/6.2 (caching) — premature optimization
