#!/bin/sh
# okf-tombstone.sh <slug> <url> [tool_path] — retire a DEAD source so the queue moves on.
#
# A permanently-uncapturable source (404, dead link, a marketing/pricing page with no
# article body) can never get a real sources/clean/<slug>.md. Since the queue ledger
# (okf-pending.sh) treats "clean doc exists" as DONE, such a source would otherwise stay
# pending forever and `advance` would re-dispatch it endlessly. The fix: write a minimal
# TOMBSTONE clean doc (`type: dead`) and commit it on the source branch, so the ledger
# retires the URL. No wiki pages are written from a tombstone — the cleaner routes it
# straight to the merger (clean.dead), which merges the tombstone to base.
#
# Mirrors okf-source-merge.sh: if <tool_path> ({{TOOL_PATH}}) is given, the script EMITS
# clean.dead itself (with commit= evidence), so the cleaner's only job is to run this one
# command. Run from the wiki repo root.

set -eu
slug="${1:?usage: okf-tombstone.sh <slug> <url> [tool_path]}"
url="${2:?usage: okf-tombstone.sh <slug> <url> [tool_path]}"
tool="${3:-}"
here="$(dirname "$0")"

# Cut/reset this source's branch from base (idempotent — discards any partial failed capture).
sh "$here/okf-source-start.sh" "$slug" >/dev/null

mkdir -p sources/clean
clean="sources/clean/$slug.md"
captured=$(date +%Y-%m-%d)
url_esc=$(printf '%s' "$url" | sed 's/"/'\''/g')

{
  echo "---"
  echo "type: dead"
  echo "source_url: $url_esc"
  echo "title: \"$slug (unreachable)\""
  echo "captured: $captured"
  echo "reason: source unreachable (dead link / 404 / no extractable article body)"
  echo "---"
  echo
  echo "This source could not be captured (dead link, 404, or a page with no article body)."
  echo "It is recorded as a tombstone so the ingest queue retires it instead of retrying"
  echo "forever. No wiki pages were written from this source."
} > "$clean"

git add -A
git commit -q -m "dead: $slug"
sha="$(git rev-parse --short HEAD)"
echo "commit=$sha"

# Self-emit clean.dead with the real evidence (and source= so the merger/advance can track).
if [ -n "$tool" ]; then
  "$tool" emit clean.dead "slug=$slug source=$url commit=$sha"
fi
