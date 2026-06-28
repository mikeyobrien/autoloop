---
name: maintain-wiki
description: Run a deep, whole-wiki health-check and maintenance pass on this OKF wiki. Use when the user asks to lint, clean up, health-check, audit, or maintain the wiki, or periodically after ingesting many sources — to find contradictions, stale claims, orphan pages, missing pages/cross-references, and broken links.
---

# Maintain this wiki

Agent-neutral workflow. `okf-init` copies this skill into both `.agents/skills/maintain-wiki/`
(where Codex and other agents that scan `.agents/skills/` find it) and
`.claude/skills/maintain-wiki/` (where Claude Code finds it) — identical copies of the preset's
canonical `skills/maintain-wiki/`. Agents that only read `AGENTS.md` are pointed here from there.

This vault is an OKF LLM-wiki built by the `autowiki` autoloop
preset. The loop runs an automatic lint as part of its maintenance batch (every 5 merged
sources + a final drain pass); THIS is the deep, on-demand, WHOLE-WIKI sweep Karpathy describes
("periodically, ask the LLM to health-check the wiki"). Run it over the whole graph whenever you
want a thorough pass between (or after) loop runs.

Knowledge lives in `concepts/` (core), `summaries/` (per-topic), `entities/`, `comparisons/`,
the single `synthesis.md` thesis, and the nav layer `index.md` / `log.md` / `overview.md`.

## Health checks (find, then FIX or FLAG)
Sweep the whole wiki for:
- **Contradictions** — pages (or the thesis) asserting conflicting claims. Make the conflict
  explicit on both sides (name each source + what it says); never silently delete one side.
- **Stale claims** — older claims a newer source superseded. Mark them superseded (link the
  newer page/claim), don't quietly erase the history.
- **Orphans** — pages with no inbound links. Add a relative link from a sensible related page
  (or from `synthesis.md` / a concept hub).
- **Missing pages** — a concept/entity referenced repeatedly but lacking its own page. Add a
  short stub (proper `type` + `sources:`), link it, and flag it to deepen later.
- **Missing cross-references** — clearly-related pages not linked to each other; add both ways.
- **Broken/loose links** — relative links pointing at non-existent files; fix the path.
- **Wikilinks** — any `[[…]]` Obsidian wikilink: CONVERT to a relative markdown link
  (`[Title](../concepts/name.md)`). This vault standardizes on relative md links (the
  pre-commit hook rejects new `[[…]]`); never leave wikilinks behind.
- **Gaps** — important sub-topics the wiki barely covers. Suggest sources/questions to fill
  them (the user can add URLs to the ingest queue, or ask via the query workflow).

## Process
1. Get the lay of the land: read `index.md` and `overview.md`, then scan the content folders.
2. Apply safe fixes (surgical — you're maintaining, not rewriting). Keep every page's
   non-empty `type`. Use relative links, not wikilinks.
3. Refresh `overview.md` if the wiki's shape has shifted, and the gists in `index.md` if any
   are stale.
4. Log it: PREPEND a maintenance entry to `log.md` (keep its `type: log` header):
   ```
   ## [<YYYY-MM-DD>] maintain | full sweep
   - fixed: <e.g. 3 contradictions flagged, 2 orphans linked, 1 stub added, 1 broken link>
   - flagged: <gaps / things to deepen / sources to add>
   ```
5. Summarize for the user what you changed and what you flagged for them to act on.

## Rules
- Read/maintain the wiki; don't fetch external sources (that's the ingest pipeline). For
  filling a gap with a new source, tell the user to add the URL to the ingest queue.
- Never edit `sources/raw/` or `sources/clean/` (immutable provenance).
- Relative links, not wikilinks. Keep changes reviewable in one git diff.
