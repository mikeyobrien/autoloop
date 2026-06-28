# OKF Wiki Pipeline

Use when you want to turn a queue of hand-curated source URLs into an OKF-conformant LLM
wiki of **tips / gold nuggets** — a connected graph of cross-linked markdown concept
pages, each a reusable, widely-applicable principle/heuristic/technique mined from the
sources, laid out in Google's Open Knowledge Format and openable in Obsidian.

Tips, NOT summaries — that's the scalability lever. Summaries stop compounding after a
handful of sources; tips keep compounding (the 50th source can be as valuable as the 2nd),
because each new source either adds a fresh nugget or strengthens an existing concept
(update, don't duplicate) — turning N sources into a connected graph.

This loop is the **ingest + maintenance engine**. Querying the built wiki is an interactive
**user skill** (`query-wiki`), not a loop role — and a deeper whole-graph health-check ships as
the `maintain-wiki` skill for periodic hand-runs — see "Using the wiki" below.

The loop is **two interleaved chains** (Karpathy's model: *Ingest is per-source; Lint is
periodic*):

- **Per-source (fast, runs for every source):** `clean → write → merge`. The roles:
  - advance (queue keeper / dispatch, maintenance cadence, finish)
  - cleaner (capture + static-extract one source)
  - foundation (base/official sources → comprehensive canonical concept pages; + entities)
  - knowledge_extractor (tip sources → mine gold-nugget insights into concepts; + entities)
  - merger (merge the source's whole branch to base)
- **Maintenance batch (heavy, runs every 5 merged sources + a final pass at queue drain):**
  `summarize → synthesize → compare → lint → index`, over the WHOLE wiki on the base branch.
  - summarize (revise the per-TOPIC summary pages)
  - synthesize (revise the single running thesis, `synthesis.md`)
  - compare (author side-by-side "X vs Y" comparison pages)
  - lint (whole-graph health-check: contradictions, orphans, missing links)
  - indexer (maintain the navigation layer: index.md, log.md, overview.md)

One task = one source URL. Each source goes clean → write → merge on its own branch; the
**write** step is `foundation` for base/official sources (comprehensive coverage) or
`knowledge_extractor` for tip sources (mined insights), picked by tier. `advance` is the gate:
on each `merge.done` it completes the task, then EITHER dispatches the next source OR (every 5th
merge, and once when the queue drains) triggers a whole-wiki maintenance batch on base before
continuing — so the five heavy passes run ~N/5 times instead of N. The loop runs until every
source is done and the final maintenance batch has run.

## Flow

```
PER-SOURCE (every source):
loop.start ─► advance ─► queue.advance ─► cleaner ─┬─ clean.base ─► foundation ──────┐
                 ▲                            │     └─ clean.tip ─► knowledge_extractor┤
                 │                            └─ clean.bad ─► cleaner (retry)         │ (foundation|extract).done
                 │                                                                    ▼
                 │                                                                  merger
                 └──────────────────────── merge.done ◄────────────────────────────────┘
                 │
                 ├─ next source ─────────► queue.advance  (most merges)
                 ├─ every 5th merge / drain ─► maintenance.due ─► [batch below]
                 └─ queue empty & maintenance done ─► queue.done  (loop completes)

MAINTENANCE BATCH (every 5 merged sources + final drain, on base over the whole wiki):
maintenance.due ─► summarize ─► synthesize ─► compare ─► lint ─► indexer ─► index.done ─► advance
```

The flow is fully topology-driven — no role decides the next step. **Per source**, one branch
goes clean → write → merge, every time: the cleaner commits the clean artifact (signalling tier
via `clean.base`/`clean.tip`), the write role its concept/entity pages (`foundation` =
comprehensive base coverage, or `knowledge_extractor` = mined tip insights) on the same
`source/<slug>` branch with deterministic labels (`clean:` / `foundation:`|`extract:`), then the
`merger` merges the whole branch to base as one unit and hands `merge.done` back to `advance`.
Nothing reaches base except via the merge.

`advance` then runs the deterministic queue keeper (`okf-advance.sh`), which dispatches the next
source on most merges but **every 5th merge — and once when the queue drains** — emits
`maintenance.due` instead, routing the **maintenance batch**: summarize → synthesize → compare →
lint → indexer, run over the WHOLE wiki **directly on the base branch** (every source in the
batch is already merged, so the maintenance commits take no slug). The summarizer revises the
topic summaries, the synthesizer the `synthesis.md` thesis, the comparator any side-by-side
pages, the linter its health-check fixes, and the indexer the navigation layer — with labels
`summarize:` / `synthesize:` / `compare:` / `lint:` / `index:`. When the batch finishes
(`index.done`), `advance` resumes (dispatch next OR finish). (`compare:` and `lint:` may be
no-ops — no comparison warranted, or the wiki was already healthy — in which case they hand off
without committing.)

## Page types

Following Karpathy's "LLM Wiki" (`karpathy-llm-wiki.md`): the wiki layer is five COLLECTIONS
(folders of many pages) plus two SINGLE evolving pages — "a synthesis" and "an overview" —
each with a matching OKF `type:`:

Collections (folders):
- `concepts/` (`type: concept`) — the **compounding core**: comprehensive canonical pages from
  base sources (foundation) + mined gold-nugget insights from tip sources (knowledge_extractor).
- `entities/` (`type: entity`) — recurring people / tools / orgs / products (foundation +
  knowledge_extractor); compound.
- `summaries/` (`type: summary`) — per-TOPIC summaries, REVISED as sources arrive (summarize).
  Secondary to concepts: an orientation aid, never where knowledge accumulates.
- `comparisons/` (`type: comparison`) — focused "X vs Y" pages: framing + table + when-to-use
  (compare). Only authored where a real contrast exists.
- `answers/` (`type: answer`) — answers to questions, filed back by the `query-wiki` skill.

Single pages:
- `synthesis.md` (`type: synthesis`) — the ONE running thesis, "what the sources add up to";
  the synthesizer REVISES it each source (it is not a folder of essays).
- `overview.md` (`type: overview`) — the start-here orientation page; the indexer evolves it
  slowly as the wiki's shape shifts.

Concepts stay the scalability lever; the others organize and cross-link the graph around it.

Every page also carries **richer frontmatter** beyond `type`/`sources`: `created`/`updated`
dates, a few `tags`, and a `source_count` on compounding pages (concepts, topic summaries,
entities) — so the vault is queryable (e.g. Obsidian Dataview) and the graph stays navigable.

## Maintenance / lint

The doc's core claim is that a wiki survives only if the maintenance burden stays near zero —
which is what an LLM is for. Maintenance happens at two granularities:
- **In the loop (automatic):** the **lint** role runs as part of the maintenance batch (every 5
  merged sources + the final drain pass), over the WHOLE wiki — contradictions, orphans, obvious
  missing cross-refs/links, the odd missing stub. It fixes what's safe, logs a `lint` entry, and
  a clean pass is a no-op. Contradiction-flagging also happens earlier (the write role marks it
  at ingest, the synthesizer carries it into the thesis), so lint is a backstop.
- **By the user (periodic, holistic):** the **`maintain-wiki` skill** sweeps the WHOLE graph —
  stale-claims-across-the-wiki, orphans, missing pages, missing cross-references, broken links,
  coverage gaps. That's the deep version of the same checklist, run on demand. See "Using the
  wiki".

## Navigation layer (indexer)

The agents that author content (foundation, knowledge_extractor, synthesizer, comparator, linter) reliably skip
"also update the index" prose, so a dedicated **indexer** role owns it — its own gated turn,
once per maintenance batch (the last step before `advance` resumes):
- `index.md` — master nav: intro links to `overview.md` + `synthesis.md`, then collections
  grouped Sources / Summaries / Concepts / Entities / Comparisons / Answers, one curated gist
  per page (sources listed by their human title). The `## Answers` section is filled by the
  query workflow, not the loop.
- `overview.md` — start-here orientation page; stable, evolves slowly as the wiki's shape shifts.
- `log.md` — newest-first log of **ingests, lint passes, queries, and maintenance** (consistent
  `## [date] <kind> | <title>` headers, so `grep "^## \[" log.md | tail` gives a timeline).
  The indexer writes the ingest entries; the linter prepends lint entries; the query/maintain
  workflows prepend their own.

These are OKF pages (relative links, non-empty `type`), maintained by the indexer (the linter
prepends lint entries to `log.md`; the query/maintain workflows prepend their own).

## Using the wiki (agent-neutral workflows)

Ingest is the autonomous half; **using** the built wiki is the interactive half — and per
Karpathy's third architecture layer, the **schema**, those workflows ship *with the vault* so
any agent opening it knows how to drive it. They're **agent-neutral skills** (autoloop is for
everyone, not just Claude): the canonical copies live in the preset's `skills/` folder, and
`okf-init` copies them into BOTH **`.agents/skills/`** (where **Codex** and other agents that
scan it auto-discover them) and **`.claude/skills/`** (where **Claude Code** auto-discovers
them) — identical copies, with **`AGENTS.md`** as the entry point for agents that read that.
(Discovery is per-agent and verified empirically: Codex reads `.agents/skills/`, Claude reads
`.claude/skills/` — neither reads the other's, so we ship both.) Rather than a `CLAUDE.md` that rides
every turn, the heavy workflow body loads on demand.

- **`query-wiki`** (`.agents/skills/query-wiki/SKILL.md`) — Karpathy's *Query* operation. Ask a
  question; it searches the wiki (bundled `.agents/skills/query-wiki/search.sh` — uses **qmd** if
  installed, else a keyword fallback), reads the top pages + `synthesis.md`, answers with
  citations, and (when useful) files the answer back as a cited `answers/<slug>.md`, listing it
  under `## Answers` and logging a `query` entry. So explorations compound instead of vanishing.
- **`maintain-wiki`** (`.agents/skills/maintain-wiki/SKILL.md`) — Karpathy's *Lint* op at depth: a
  whole-graph health-check (contradictions, stale claims, orphans, missing pages/cross-refs,
  broken links, gaps), run periodically by you. Complements the loop's batched lint (every 5
  merged sources + final drain).

All of this ships in the `vault/` template, so `okf-init.sh` lays it down (committed, no-clobber,
so you can co-evolve it). Just `cd` into the vault, open your agent, and ask — Claude users can
also run `/query-wiki` / `/maintain-wiki`.

## Context isolation

The claude-sdk backend uses a fresh session per role, so the cleaner's noisy raw
page content never reaches the write role's context window — no nesting required. The
cleaner captures the original to `sources/raw/<slug>.<ext>` and produces
`sources/clean/<slug>.md` by **static extraction** (the literal output of
`agent-browser read`, not LLM-authored prose) so the clean text can't hallucinate;
the write roles only ever read `sources/clean/`.

## Per-source routing (cleaner)

The cleaner picks an extraction strategy from the URL, by prose (no regex needed):
- **GitHub** (`github.com/<owner>/<repo>`, `gist.github.com`, `raw.githubusercontent.com`)
  → shallow-clone into the per-run `{{STATE_DIR}}/scratch/repo` and read/grep locally.
  Never scrape the rendered repo HTML (token sink + context rot). `*.github.io` is a
  normal website.
- **YouTube** (`youtube.com`, `youtu.be`) → transcript + keyframe screenshots.
- **Everything else** → agent-browser (real Chrome) scrape.

The cleaner deletes its own clone at the end of its turn. (No `post_iteration`
cleanup hook: a hook writes a `hook.output` event every iteration that the router
treats as a routing emit and rejects, which wedges the event-driven loop.)

## Per-source branches

One branch per source for the **ingest** half; the **whole branch merges as a unit**, so a
source's clean + concept/entity pages reach base together or not at all — atomic, with clean
rollback if a pass goes bad. The git lifecycle lives in scripts the roles reliably run (not role
prose, which agents skip):

- the cleaner's `okf-capture.sh` cuts `source/<slug>` from base (main/master,
  auto-detected) and commits the raw+clean artifacts on it;
- the write role (`foundation` or `knowledge_extractor`) `okf-commit.sh <label> <slug>` its
  concept/entity pages on the same branch — no merge;
- the `merger` runs `okf-source-merge.sh <slug> {{TOOL_PATH}}`, which merges the branch and
  emits `merge.done` itself. The merge is its own gated step (`merge.done` requires `merged=`)
  and the script self-emits, so the agent can't hand-roll a merge or fabricate evidence.

The **maintenance** roles (summarize / synthesize / compare / lint / indexer) do NOT use a
source branch — they run after the relevant sources are already merged, so they `okf-commit.sh
<label> batch` **directly on base** over the whole graph (slug is the literal `batch`).

Sources run one at a time, so merges are sequential and conflict-free. Ingest pages reach base
only through the merger's merge; maintenance commits land on base directly (the batch only runs
once its sources are merged).

## Synthesis cadence

Synthesis runs **once per maintenance batch** — every 5 merged sources + a final pass when the
queue drains — not once per source. The topology routes `summary.done → synthesize` within the
batch, so a synthesis pass always runs (and always produces its own `synthesize: batch` commit,
revising the single `synthesis.md`, on base) whenever the batch fires. Batching the five heavy
whole-wiki passes (summarize/synthesize/compare/lint/index) keeps them off the per-source
critical path, so they run ~N/5 times instead of N. The cadence is owned by `okf-advance.sh`
(deterministic counter), not by role reasoning.

## Files

- `autoloops.toml` — loop + backend config
- `topology.toml` — role deck + handoff graph
- `harness.md` — shared rules loaded every iteration (OKF, verbatim prose, scratch discipline)
- `roles/advance.md`, `roles/cleaner.md`, `roles/foundation.md`, `roles/knowledge-extractor.md`, `roles/summarize.md`, `roles/synthesize.md`, `roles/compare.md`, `roles/lint.md`, `roles/indexer.md`, `roles/merger.md`
- `vault/` — the **template fresh vault**, copied into the target dir on bootstrap: the folder
  structure (+ `.gitkeep`), the single pages `index.md`/`log.md`/`overview.md`/`synthesis.md`
  (with an `{{AUTOWIKI_NAME}}` placeholder), and `AGENTS.md`. Edit files here to change what a
  fresh vault contains.
- `skills/` — the canonical user-facing skills (`query-wiki` with bundled `search.sh`,
  `maintain-wiki`); `okf-init` copies this folder into both `.agents/skills/` and
  `.claude/skills/` in the created vault (Codex + Claude discovery).
- `scripts/okf-init.sh` — vault bootstrap: copy `vault/` (no-clobber) + interpolate name +
  queue sync (run by `advance` on loop start)
- `scripts/okf-pending.sh` — lists not-yet-captured sources, foundation-first (incremental seed)
- `scripts/okf-slug.sh` — deterministic URL→slug (run by `advance` on dispatch)
- `scripts/okf-*.sh` — capture / branch-start / commit helpers and `okf-source-merge.sh`
  (the per-source merge, run by the `merger`)
- `hooks/pre-commit` — OKF validator; the loop points `core.hooksPath` here automatically

## Backend

This preset assumes the built-in claude-sdk adapter (fresh session per role):

```toml
backend.kind = "claude-sdk"
backend.command = "claude"
```

For deterministic local harness debugging only, switch to the repo mock backend:

```toml
backend.kind = "command"
backend.command = "../../examples/mock-backend.sh"
```

## Setup

The vault is created **by the loop itself** — no manual scaffold. You only install
the capture dependency and point the run at a directory via env vars.

1. Install **agent-browser** (the real-Chrome capture CLI the cleaner uses for web
   sources) and `jq`:
   ```bash
   npm i -g agent-browser && agent-browser install   # `install` fetches Chromium
   brew install jq                                    # or apt-get install jq
   ```
   The cleaner loads agent-browser's own reference at runtime via
   `agent-browser skills get core --full`, so it always matches the installed version.

   Optional: install **qmd** (https://github.com/tobi/qmd) for better wiki search as it
   grows — the `query-wiki` skill uses it if present and falls back to a keyword search
   otherwise, so it's not required.

2. Curate the queue — a plain text file, one source URL per line (blanks / `#`
   comments ignored):
   ```
   https://youtube.com/watch?v=...
   https://github.com/owner/repo
   https://someblog.com/post
   ```
   (Questions aren't a queue — you ask them interactively later via the `query-wiki` skill.)

## Run

Set the env vars, `cd` into the (possibly empty / not-yet-existing) vault directory,
and run. On `loop.start` the `advance` role runs `scripts/okf-init.sh`, which `git init`s,
copies the preset's `vault/` template into the dir (no-clobber: the folder structure, the
titled single pages `index.md`/`overview.md`/`synthesis.md`/`log.md`, and `AGENTS.md`),
interpolates the wiki name, copies the preset's `skills/` into both `.agents/skills/` and
`.claude/skills/`, seeds `queue.base.txt` + `queue.txt`, and installs the OKF pre-commit hook —
all idempotent.

```bash
export AUTOWIKI_NAME="Claude Code Hooks & Skills Wiki"   # wiki title
export AUTOWIKI_BASE_QUEUE_FILE="$HOME/base.txt"         # optional: FOUNDATION sources (official docs), built first
export AUTOWIKI_QUEUE_FILE="$HOME/queue.txt"             # TIP sources (or AUTOWIKI_QUEUE="url1 url2 ...")
export AUTOWIKI_PATH="$HOME/autowiki-claude-code"        # optional; if set must equal cwd

mkdir -p "$AUTOWIKI_PATH" && cd "$AUTOWIKI_PATH"
autoloop run autowiki "process the source queue into the OKF wiki" -i 80
```

Required env vars: `AUTOWIKI_NAME` and one of `AUTOWIKI_QUEUE_FILE` / `AUTOWIKI_QUEUE`.
`AUTOWIKI_BASE_QUEUE_FILE` (foundation sources, built first) is optional. If a required var is
missing, `okf-init.sh` aborts the first turn with a message saying which.

The preset is the single source of truth for the scripts. `okf-init.sh` copies the
`okf-*.sh` capture/branch/commit helpers into the vault's `scripts/` on every bootstrap
(so the agents find them at the path they expect — `./scripts/` — instead of hunting an
absolute path) and gitignores `scripts/`, so they're refreshed each run and never
pollute the wiki history. The pre-commit hook is referenced in place via
`core.hooksPath`. Tracked vault content is the wiki + `queue.txt` + the agent workflows
(`AGENTS.md`, `.agents/skills/`, `.claude/skills/`); `.autoloop/` and `scripts/` are gitignored.

## Adding sources later (incremental updates)

The wiki grows incrementally — append URLs and re-run; only the NEW sources process. A
source is "done" once its `sources/clean/<slug>.md` exists, so the committed clean docs are
the ledger (no separate state file, survives across sessions).

1. Append the new URLs to `AUTOWIKI_BASE_QUEUE_FILE` / `AUTOWIKI_QUEUE_FILE`.
2. Re-run `autoloop run autowiki …` from the vault with the same env vars. `okf-init.sh`
   re-syncs the vault's `queue.base.txt` / `queue.txt` from the env, then `advance` seeds only
   the pending sources (`scripts/okf-pending.sh` skips any already captured). The write role
   compounds the new sources onto the existing concept graph.

If nothing is pending, the run completes immediately (`done=0`). Note this is distinct
from `autoloop resume <run-id>`, which continues the *same* run's existing queue (e.g.
after an interruption) rather than picking up appended URLs.

## Pre-commit hook scope

`hooks/pre-commit` (POSIX `sh` + `awk` — **no Node or module-type dependency**) enforces two
things: (1) **OKF conformance** — every staged Markdown file must have YAML frontmatter with a
non-empty `type`; and (2) **one portability gate** — no Obsidian `[[wikilinks]]` in wiki content
(the vault standardizes on relative md links like `[text](../dir/name.md)` so pages render
outside Obsidian too, e.g. on GitHub). Per OKF's permissive stance it does NOT gate on
broken/relative links beyond that. `sources/raw/` (verbatim captures), `AGENTS.md`, `.agents/`,
and `.claude/` are exempt (they carry skill `name`/`description` frontmatter, or none, not OKF
`type`). It validates the staged blob (`git show :path`), covers Added/Copied/Modified/Renamed
files. `okf-init.sh` wires it in via `git config core.hooksPath` (pointing at the preset) — no
manual install.

Extend it for vault-specific rules if you want — restrict `type` to an allowed set,
require `index.md` / `log.md`, or enforce a field your tooling depends on. Kept to
spec-minimum by default so it never rejects valid OKF that simply doesn't match
local assumptions.

## Notes / open items

- Per-source branches use plain git branches (not worktrees): worktree isolation is
  per-run in autoloop, so the lifecycle lives in scripts on a single checkout —
  `okf-capture.sh` cuts `source/<slug>` from the auto-detected base, the write role
  commits on it via `okf-commit.sh`, and the `merger` role merges it back
  `--no-ff` with `okf-source-merge.sh`. Sources run one at a time, so merges are
  sequential and conflict-free. (The maintenance batch commits on base directly, not on a
  source branch.)
- Stuck dead URL: the cleaner caps retries at 3, then `advance` drops the task so
  one bad source can't wedge the run.
