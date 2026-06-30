#!/bin/sh
# okf-source-start.sh <slug> — begin a per-source branch.
#
# Each source is processed on its own `source/<slug>` branch cut fresh from the base
# branch (main/master), so the cleaner + write-role commits for one source land together
# and merge back atomically (see okf-source-merge.sh). Run by the `advance` role when
# it dispatches a source — the cleaner/write role then just commit on the current branch.
#
# Run from the wiki repo root.

set -eu
slug="${1:?usage: okf-source-start.sh <slug>}"

# Determine the base branch (the branch we're on when NOT already on a source/*
# branch) and remember it for the merge step. `.git/` is never tracked.
cur="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
case "$cur" in
  source/*) base="$(cat .git/okf-base 2>/dev/null || echo main)" ;;
  *)        base="$cur"; printf '%s\n' "$base" > .git/okf-base ;;
esac

git checkout -q -B "source/$slug" "$base"
echo "branch=source/$slug base=$base"
