#!/bin/sh
# okf-capture.sh <url> <slug> — deterministic source capture for the OKF cleaner.
#
# Produces TWO artifacts, both machine-generated (no LLM authoring => no hallucination):
#   sources/raw/<slug>.<ext>  — the original, verbatim (provenance)
#   sources/clean/<slug>.md   — OKF frontmatter + the source text
#
# Two capture modes, picked from the URL:
#   * Raw MARKDOWN (URL ends in .md/.markdown — e.g. code.claude.com/docs/en/hooks.md):
#     download verbatim with curl. It is ALREADY clean text — do NOT render it through a
#     browser (that would wrap it in HTML chrome and re-extract, mangling it).
#   * HTML page (everything else): load in real Chrome (agent-browser, JS renders), save
#     the rendered HTML, then statically extract its text (agent-browser's own `read`).
#
# Run from the wiki repo root. Requires: curl; for HTML, agent-browser (or npx) + jq.
# The cleaner role invokes THIS — it must not fetch or extract any other way.

set -eu

url="${1:?usage: okf-capture.sh <url> <slug>}"
slug="${2:?usage: okf-capture.sh <url> <slug>}"

ab() {
  if command -v agent-browser >/dev/null 2>&1; then agent-browser "$@"
  else npx agent-browser "$@"; fi
}

# 0. Cut this source's branch from base (so the cleaner+write+synth commits land together
#    and merge back atomically). Done here because the agent reliably runs this one script.
sh "$(dirname "$0")/okf-source-start.sh" "$slug" >/dev/null

mkdir -p sources/raw sources/clean
clean="sources/clean/$slug.md"
captured=$(date +%Y-%m-%d)

# strip query/fragment when testing the extension
urlpath=${url%%\?*}; urlpath=${urlpath%%#*}
case "$urlpath" in
  *.md | *.markdown)
    # ---- raw markdown: download verbatim, no browser ----
    raw="sources/raw/$slug.md"
    curl -fsSL "$url" -o "$raw"
    if [ ! -s "$raw" ]; then
      echo "okf-capture: empty markdown download from $url" >&2
      exit 1
    fi
    # title = first H1 heading, else the slug. (Used by the indexer for the log/index entry.)
    title=$(grep -m1 '^# ' "$raw" 2>/dev/null | sed 's/^#* *//; s/[[:space:]]*$//')
    [ -n "$title" ] || title="$slug"
    title=$(printf '%s' "$title" | tr -d '\r' | sed 's/"/'\''/g')
    {
      echo "---"; echo "type: source"; echo "source_url: $url"; echo "title: \"$title\""
      echo "raw_capture: ../raw/$slug.md"; echo "captured: $captured"; echo "---"; echo
      cat "$raw"
    } > "$clean"
    ;;
  *)
    # ---- HTML page: render in Chrome, save HTML, static-extract text ----
    raw="sources/raw/$slug.html"
    ab open "$url" >/dev/null
    # title from the live page (used by the indexer for the log/index entry); fall back to slug.
    title=$(ab eval "document.title" 2>/dev/null | jq -r . 2>/dev/null | tr -d '\r' | sed 's/^ *//; s/ *$//; s/"/'\''/g')
    [ -n "$title" ] || title="$slug"
    # `eval` returns a JSON-quoted string; jq -r decodes it.
    ab eval "document.documentElement.outerHTML" | jq -r . > "$raw"
    first=$(head -c 1 "$raw" 2>/dev/null || true)
    if [ "$first" != "<" ]; then
      echo "okf-capture: raw capture is not HTML (first char='$first') for $url" >&2
      exit 1
    fi
    ab open "file://$(pwd)/$raw" >/dev/null
    body=$(ab read)
    ab close >/dev/null 2>&1 || true
    if [ -z "$body" ]; then
      echo "okf-capture: empty extraction from $raw" >&2
      exit 1
    fi
    {
      echo "---"; echo "type: source"; echo "source_url: $url"; echo "title: \"$title\""
      echo "raw_capture: ../raw/$slug.html"; echo "captured: $captured"; echo "---"; echo
      printf '%s\n' "$body"
    } > "$clean"
    ;;
esac

# Commit the two artifacts ("cleaner commit"). Print the short sha for the clean.base/clean.tip
# payload. Tolerate an empty diff: a re-capture (refresh) of byte-identical content has nothing
# to stage — print commit=none (exit 0) instead of letting `git commit` fail under set -e. A
# FRESH capture always has new files to stage, so it commits normally with a real sha.
git add "$raw" "$clean"
echo "okf-capture: wrote $raw and $clean"
if git diff --cached --quiet; then
  echo "commit=none"
else
  git commit -q -m "clean: $slug"
  echo "commit=$(git rev-parse --short HEAD)"
fi
