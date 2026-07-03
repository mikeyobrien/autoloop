# AGENTS.md

This directory is an **OKF LLM-wiki** built by the `autowiki` autoloop preset — a connected
graph of tips/concepts mined from curated sources. You (any coding agent) are here to **use**
the built wiki, not to re-ingest it.

## Layout
- `concepts/` — per-tip pages (the core); `summaries/` — per-topic; `entities/`;
  `comparisons/`; `answers/` — saved Q&A.
- `synthesis.md` — the single running thesis; `overview.md` — start here.
- `index.md` — master nav; `log.md` — newest-first history.
- `sources/clean/<slug>.md` — verbatim source extractions (provenance); `sources/raw/` — originals.
  Treat `sources/` as immutable.

## Conventions
- Every wiki page has YAML frontmatter with a non-empty `type`; links are relative
  (Obsidian-style), not wikilinks. Provenance points at `sources/clean/…`, never raw URLs.

## Workflows (read the file, then follow it)
- **Answer a question** against the wiki (and optionally file the answer back):
  → `.agents/skills/query-wiki/SKILL.md`
- **Maintain / health-check** the whole wiki (contradictions, stale claims, orphans, gaps):
  → `.agents/skills/maintain-wiki/SKILL.md`

These are agent-skills, installed in both `.agents/skills/` (Codex and other agents that scan
it) and `.claude/skills/` (Claude Code) — identical copies, so each agent auto-discovers them
natively.

## Not your job here
Ingesting new sources is the autoloop pipeline's job, not an interactive one. To add sources,
append URLs to the ingest queue and re-run `autoloop run autowiki …`.
