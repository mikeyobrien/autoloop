---
name: query-wiki
description: Answer a question using this OKF wiki and (optionally) file the answer back as a reusable page. Use when the user asks a question about the wiki's subject matter, asks "what does the wiki say about X", or wants an answer synthesized from the wiki's concepts/synthesis with citations.
---

# Query this wiki

Agent-neutral workflow. `okf-init` copies this skill into both `.agents/skills/query-wiki/`
(where Codex and other agents that scan `.agents/skills/` find it) and
`.claude/skills/query-wiki/` (where Claude Code finds it) — identical copies of the preset's
canonical `skills/query-wiki/`. Agents that only read `AGENTS.md` are pointed here from there.

This vault is an OKF LLM-wiki built by the `autowiki` autoloop preset.
Knowledge lives in `concepts/` (per-tip pages, the core), `summaries/` (per-topic), `entities/`,
`comparisons/`, the single `synthesis.md` (the running thesis), and `overview.md` (start here).
Each `sources/clean/<slug>.md` is the verbatim extraction a claim traces back to.

Your job: answer the user's question FROM the wiki, with citations — and, when the answer is
worth keeping, file it back as `answers/<slug>.md` so explorations compound (Karpathy's Query
operation: "good answers can be filed back into the wiki as new pages").

## Steps
1. **Search** — don't guess which pages are relevant; run the bundled helper (qmd if
   installed, else a keyword fallback), from the vault root:

       sh .agents/skills/query-wiki/search.sh "<the question>"

   It prints the best-matching page paths, most relevant first.
2. **Read** the top hits, plus `synthesis.md` and `overview.md` for framing, and follow their
   relative links into the concepts they cite. For a verbatim quote you may open the relevant
   `sources/clean/<slug>.md` (never `sources/raw/`).
3. **Answer** the user directly, citing the wiki pages you drew on with relative links
   (`[hooks](concepts/hooks.md)`, `[synthesis](synthesis.md)`). Quote prose verbatim where you
   quote. If the wiki can't answer it, say so plainly and name the gap (a candidate for a
   future source) rather than inventing an answer.
4. **Offer to file it back.** If the answer is reusable, ask the user (or just do it if they
   asked you to save it), writing `answers/<slug>.md` with `<slug>` a short kebab-case form of
   the question:
   - Frontmatter: `type: answer`, `question: "<the question>"`, `created: <YYYY-MM-DD>`,
     `sources:` listing the relative clean-doc paths behind what you cited
     (`../sources/clean/<slug>.md`), `tags:` a few. NEVER raw `http(s)://` URLs in `sources:`.
   - Body: the answer + its citations (relative links).
   - Add a bullet under `## Answers` in `index.md`:
     `- [<question>](answers/<slug>.md) — <one-line gist>`.
   - Prepend a log entry to `log.md` (keep its `type: log` header):
     `## [<YYYY-MM-DD>] query | <question>` with an `- answer:` and `- cited:` line.

## Rules
- Answer from the wiki; don't fetch external sources here (that's the ingest pipeline's job).
- Relative links, not wikilinks. Every page you create needs a non-empty `type`.
- One `answers/` page per question; if it exists, refresh it instead of duplicating.
