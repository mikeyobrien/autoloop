# OKF Wiki Pipeline — shared rules

This loop turns curated source URLs into an OKF wiki: a connected graph of cross-linked
markdown pages. YOUR job is defined in your own role prompt — below are ONLY the rules common
to every role. (Other roles' jobs, the tier/page-type details, and the folder map live in the
role that needs them, not here.)

- **One job per turn.** Do your role's single job and hand off; never reach into another
  role's responsibility or emit on its behalf.
- **Routing/backpressure.** Emit only an event your prompt's routing context allows — an
  out-of-set event is rejected and you'll be asked to re-route. Events publish ONLY by actually
  running the event tool; printing the command text does nothing.
- **OKF conformance (hook-enforced).** Every wiki markdown file has YAML frontmatter with a
  non-empty `type`. Cross-link with relative MARKDOWN links — `[text](../dir/name.md)` — NEVER
  Obsidian `[[wikilinks]]`. The pre-commit hook rejects both violations, so a bad commit fails;
  get it right the first time.
- **Provenance → the local clean doc, never the URL.** A page you author lists in its
  `sources:` the relative path(s) to `sources/clean/<slug>.md` (root-relative from
  `synthesis.md`); only the clean doc carries the original `source_url`. Quote source prose
  verbatim — never paraphrase a quote.
- **Frontmatter beyond `type`.** On pages you author, also set `created` / `updated` dates, a
  few `tags`, and — on pages that compound (concepts, topic summaries, entities) — a
  `source_count` you bump when folding in a new source.
- **Scratch is ephemeral.** Anything under `{{STATE_DIR}}/scratch/` is wiped after each
  iteration; persisted work goes to `sources/` or the wiki.
