#!/bin/sh
# okf-pending.sh — print the sources that still need processing, one per line as
# "<url> tier=<base|tip>", foundation tier first. `advance` seeds the per-run task store
# from this on loop start.
#
# A source is considered DONE when its `sources/clean/<slug>.md` already exists (it was
# captured and merged in an earlier run). So you can APPEND urls to queue.base.txt /
# queue.txt and re-run: only the new sources are emitted here and get processed (the
# write role compounds them onto the existing wiki). The committed clean docs ARE the
# "already done" ledger — no separate state file, survives across sessions.
#
# (Querying the built wiki is a separate, interactive USER workflow — see the vault's
# CLAUDE.md — not part of this ingest queue.)
#
# Run from the wiki repo root. Blank lines and `#` comments are ignored.

set -eu
here="$(dirname "$0")"

# REFRESH mode (AUTOWIKI_REFRESH set): instead of listing UN-captured sources, list the
# already-captured BASE sources to RE-CHECK for upstream changes — official-docs (base) tier
# only, skipping ones already re-checked this pass (.autoloop/refresh-checked) and dead
# tombstones (type: dead). NORMAL mode: list UN-captured sources, base tier first.
refresh="${AUTOWIKI_REFRESH:-}"
checked=".autoloop/refresh-checked"

is_checked() { [ -f "$checked" ] && grep -qxF "$1" "$checked"; }
is_dead()    { head -5 "sources/clean/$1.md" 2>/dev/null | grep -q '^type: dead'; }

emit_tier() {
  tier="$1"; file="$2"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace. Use [[:space:]], NOT [ \t]: on BSD/macOS sed, `\t`
    # inside a bracket is the literal set {space, backslash, t} — so a URL ending in `t`
    # (…enforcement, …management) would lose its final `t` and 404. [[:space:]] is portable.
    url=$(printf '%s' "$line" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    case "$url" in '' | \#*) continue ;; esac
    slug=$(sh "$here/okf-slug.sh" "$url")
    if [ -n "$refresh" ]; then
      [ -f "sources/clean/$slug.md" ] || continue   # not captured -> nothing to refresh
      is_dead "$slug" && continue                    # dead tombstone -> don't re-fetch
      is_checked "$slug" && continue                 # already re-checked this pass -> skip
    else
      [ -f "sources/clean/$slug.md" ] && continue    # already captured -> skip
    fi
    printf '%s tier=%s\n' "$url" "$tier"
  done < "$file"
}

emit_tier base queue.base.txt
[ -n "$refresh" ] || emit_tier tip queue.txt   # refresh re-checks base/official docs only
