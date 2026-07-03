#!/bin/sh
# search.sh <query...> — find wiki pages relevant to a query; print the best-matching file
# paths (one per line, most relevant first). Bundled with the `query-wiki` skill so the
# query workflow is self-contained (survives a fresh clone of the vault). Run from the vault
# root.
#
# Backend, in order of preference:
#   1. qmd (https://github.com/tobi/qmd) — local hybrid BM25/vector search with LLM re-rank,
#      on-device. Used if `qmd` is on PATH; recommended as the wiki grows past ~100 sources.
#   2. Fallback — ripgrep/grep over the wiki markdown for the query's words, ranked by how
#      many distinct query terms each file matches. Zero extra dependencies (qmd is optional).
#
# Searches the content folders + the single pages; never the raw/clean sources or run state.

set -eu
[ "$#" -ge 1 ] || { echo "usage: search.sh <query...>" >&2; exit 1; }
query="$*"

dirs="concepts summaries entities comparisons answers"
files="synthesis.md overview.md index.md"

if command -v qmd >/dev/null 2>&1; then
  qmd search "$query" --path . 2>/dev/null && exit 0
  # if qmd errored, fall through to grep
fi

GREP="grep"
command -v rg >/dev/null 2>&1 && GREP="rg"

cand=$(
  for d in $dirs; do [ -d "$d" ] && find "$d" -name '*.md' ! -name '.gitkeep'; done
  for f in $files; do [ -f "$f" ] && echo "$f"; done
)
[ -n "$cand" ] || exit 0

printf '%s\n' "$cand" | while IFS= read -r f; do
  score=0
  for w in $query; do
    case "$w" in [a-zA-Z0-9]*) : ;; *) continue ;; esac
    if "$GREP" -qi -- "$w" "$f" 2>/dev/null; then score=$((score + 1)); fi
  done
  [ "$score" -gt 0 ] && printf '%s\t%s\n' "$score" "$f"
done | sort -rn | cut -f2-
