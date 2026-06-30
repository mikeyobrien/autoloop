#!/bin/sh
# okf-init.sh — bootstrap the OKF wiki vault from env vars. Run by the `advance` role
# on loop.start (idempotent: safe to re-run, never clobbers existing content).
#
# Operates in the CURRENT directory (the work dir = the vault; the user `cd`s into the
# vault before `autoloop run`). Required env vars — the run cannot proceed without them:
#   AUTOWIKI_NAME             wiki title (goes in index.md)
#   AUTOWIKI_QUEUE_FILE       path to a file of TIP source URLs (one per line)  } provide at
#     - or - AUTOWIKI_QUEUE   inline tip source URLs, newline/space-separated   } least one
# Optional:
#   AUTOWIKI_BASE_QUEUE_FILE  path to a file of FOUNDATION source URLs (official docs etc.)
#                             processed FIRST, in foundation mode (comprehensive coverage),
#                             to build the base the tips compound onto.
#   AUTOWIKI_PATH             the vault path; if set it MUST equal the cwd (a guard so a
#                             stray cwd can't scaffold the wrong directory).
#
# Bootstrap = git repo + a no-clobber COPY of the preset's `vault/` template (the literal
# fresh vault: folder structure, the single pages index/log/overview/synthesis, and the
# single pages + AGENTS.md), with the name interpolated, then copies the preset's `skills/`
# folder into BOTH .agents/skills/ (Codex et al.) and .claude/skills/ (Claude) so each agent
# discovers them natively. Then it syncs queue.base.txt + queue.txt from the env, refreshes the gitignored ./scripts
# copies, and points core.hooksPath at the preset's OKF pre-commit hook. To change what a
# fresh vault contains, edit files under the preset's `vault/` — not this script.
#
# Querying and deep maintenance of the BUILT wiki are interactive USER workflows shipped in the
# template (not loop roles). The loop only ingests + light-lints.

set -eu

fail() { echo "okf-init: $1" >&2; exit 1; }

# --- validate env -----------------------------------------------------------------
[ -n "${AUTOWIKI_NAME:-}" ] || fail "AUTOWIKI_NAME is not set (the wiki title)."
if [ -n "${AUTOWIKI_PATH:-}" ] && [ "$(cd "$AUTOWIKI_PATH" 2>/dev/null && pwd)" != "$(pwd)" ]; then
  fail "AUTOWIKI_PATH ($AUTOWIKI_PATH) is not the current dir ($(pwd)). cd into the vault, or unset AUTOWIKI_PATH."
fi
if [ -z "${AUTOWIKI_QUEUE_FILE:-}" ] && [ -z "${AUTOWIKI_QUEUE:-}" ]; then
  fail "set AUTOWIKI_QUEUE_FILE (a file of tip URLs) or AUTOWIKI_QUEUE (inline tip URLs)."
fi
if [ -n "${AUTOWIKI_QUEUE_FILE:-}" ] && [ ! -f "$AUTOWIKI_QUEUE_FILE" ]; then
  fail "AUTOWIKI_QUEUE_FILE ($AUTOWIKI_QUEUE_FILE) does not exist."
fi
if [ -n "${AUTOWIKI_BASE_QUEUE_FILE:-}" ] && [ ! -f "$AUTOWIKI_BASE_QUEUE_FILE" ]; then
  fail "AUTOWIKI_BASE_QUEUE_FILE ($AUTOWIKI_BASE_QUEUE_FILE) does not exist."
fi

# --- git repo ---------------------------------------------------------------------
if [ ! -d .git ]; then
  git init -q
  git config user.name  >/dev/null 2>&1 || git config user.name  "autowiki"
  git config user.email >/dev/null 2>&1 || git config user.email "autowiki@local"
fi

# Point git at the preset's OKF pre-commit hook (gates non-empty `type` frontmatter).
hooks_dir="$(cd "$(dirname "$0")/../hooks" && pwd)"
git config core.hooksPath "$hooks_dir"

# --- gitignore (run state, script copies, and operational junk) --------------------
# scripts/ holds copies of the preset's okf-*.sh so the agents find them at the path
# they expect (./scripts/) — but they're canonical in the preset, re-copied below on
# every bootstrap, so we DON'T track them (keeps the wiki history to content only).
# `*.out` / `*.log` cover run/dashboard logs and `.DS_Store` macOS cruft, so the commit
# scripts' `git add -A` can never sweep operational files into the wiki history.
for line in ".autoloop/" "scripts/" "*.out" "*.log" ".DS_Store"; do
  grep -qxF "$line" .gitignore 2>/dev/null || echo "$line" >> .gitignore
done

# --- refresh the agent-facing script copies from the preset (canonical) ------------
mkdir -p scripts
for f in "$(dirname "$0")"/okf-*.sh; do
  [ "$(basename "$f")" = "okf-init.sh" ] && continue   # bootstrap stays in the preset
  cp "$f" scripts/
done
chmod +x scripts/*.sh 2>/dev/null || true

# --- scaffold the vault from the template (no-clobber: never overwrites your content) ------
# The preset's vault/ IS a literal fresh vault: the folder structure (+ .gitkeep), the single
# pages (index / overview / synthesis / log), and AGENTS.md. Synthesis is a SINGLE evolving page
# (synthesis.md), not a folder — Karpathy's "a synthesis"; collections are the folders. Copying
# no-clobber fills in only what's MISSING — so a re-run (incremental updates) never touches the
# wiki you've built, while a newly-added template file still lands. The okf-*.sh scripts are NOT
# in the template — they're refreshed per-run above and gitignored.
tmpl="$(cd "$(dirname "$0")/../vault" && pwd)"
# NOTE: BSD `cp -n` EXITS 1 when it skips an already-present file (GNU exits 0). On a re-run
# every template file already exists, so it always skips and returns 1 — which under `set -e`
# would abort the whole bootstrap. The skip IS the intended no-clobber behavior, so tolerate
# the non-zero exit. (A first run on an empty vault copies everything and returns 0 normally.)
cp -Rn "$tmpl"/. . || true

# Interpolate the wiki name into the freshly-seeded pages (a no-op once already replaced, so
# re-runs leave your edited titles alone). Escape sed-special chars in the name first.
name_esc=$(printf '%s' "$AUTOWIKI_NAME" | sed 's/[\\&|]/\\&/g')
for f in index.md overview.md synthesis.md; do
  if [ -f "$f" ] && grep -q '{{AUTOWIKI_NAME}}' "$f" 2>/dev/null; then
    sed "s|{{AUTOWIKI_NAME}}|$name_esc|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

# --- install the user-facing skills into BOTH agent locations (real copies, no symlinks) -----
# Canonical source is the preset's `skills/` (a normal tracked folder, NOT a gitignored dotdir).
# Codex (and other agents that scan .agents/skills/) discover them there; Claude Code discovers
# them in .claude/skills/. We copy the SAME folder into both so each agent finds them natively;
# AGENTS.md points anything that only reads it at the workflows. No-clobber so a re-run never
# clobbers skills you've edited.
skills_src="$(cd "$(dirname "$0")/../skills" && pwd)"
for dst in .agents/skills .claude/skills; do
  mkdir -p "$dst"
  cp -Rn "$skills_src"/. "$dst"/ 2>/dev/null || true   # BSD cp -n exits 1 on skip; tolerate it
done
chmod +x .agents/skills/*/*.sh .claude/skills/*/*.sh 2>/dev/null || true

# --- sync the two tier queues from the env on every bootstrap ---------------------
# The env queue files are the source of truth; mirror them into the vault each run so
# appending URLs there propagates. advance seeds the per-run task store from these
# (foundation first), but skips any source already captured (see okf-pending.sh) — so a
# re-run with extra URLs only processes the NEW ones.
#   queue.base.txt — FOUNDATION sources (optional): comprehensive base, processed first.
#   queue.txt      — TIP sources: gold nuggets that compound onto the base.
# (Resume skips this bootstrap, so an in-flight run's queue stays stable mid-run.)
if [ -n "${AUTOWIKI_BASE_QUEUE_FILE:-}" ]; then
  cp "$AUTOWIKI_BASE_QUEUE_FILE" queue.base.txt
fi
if [ -n "${AUTOWIKI_QUEUE_FILE:-}" ]; then
  cp "$AUTOWIKI_QUEUE_FILE" queue.txt
elif [ -n "${AUTOWIKI_QUEUE:-}" ]; then
  printf '%s\n' "$AUTOWIKI_QUEUE" | tr ' ' '\n' | sed '/^$/d' > queue.txt
fi

# --- initial commit ---------------------------------------------------------------
git add -A
if git diff --cached --quiet; then
  echo "okf-init: vault already initialized at $(pwd)"
else
  git commit -q -m "autowiki: init vault \"$AUTOWIKI_NAME\""
  echo "okf-init: initialized vault at $(pwd)"
fi
echo "init=ok name=$AUTOWIKI_NAME base=$([ -f queue.base.txt ] && wc -l < queue.base.txt | tr -d ' ' || echo 0) tips=$(wc -l < queue.txt | tr -d ' ')"
