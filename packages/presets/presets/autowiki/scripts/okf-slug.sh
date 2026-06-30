#!/bin/sh
# okf-slug.sh <url> — deterministic, filesystem/branch-safe slug from a URL.
#
# Same URL -> same slug, every time and in every role (no LLM string-munging variance).
# Rule: lowercase; drop scheme, leading `www.`, query (`?...`) and fragment (`#...`) and
# any trailing slash; then map every run of non-alphanumeric chars to a single `-` and
# trim leading/trailing `-`. Host and path words are kept (so slugs stay human-readable
# and distinct across the queue). Run by `advance` on dispatch; the resulting slug names
# the `source/<slug>` branch and the `sources/raw|clean/<slug>` artifacts.

set -eu
url="${1:?usage: okf-slug.sh <url>}"

s=$(printf '%s' "$url" | tr 'A-Z' 'a-z')
s=${s#https://}
s=${s#http://}
s=${s#www.}
s=${s%%#*}      # drop fragment
s=${s%%\?*}     # drop query string
s=${s%/}        # drop a single trailing slash

slug=$(printf '%s' "$s" | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-*//' -e 's/-*$//')
[ -n "$slug" ] || slug="source"
printf '%s\n' "$slug"
