#!/bin/sh
# okf-source-merge.sh <slug> [tool_path] — merge a finished source branch into base AND
# (optionally) emit the merge.done event itself.
#
# Atomic per-source integration: checkout the base branch (main/master), merge
# `source/<slug>` with a merge commit (--no-ff), delete the branch. Run by the `merger`
# role once per source, after the synthesizer's commit. Sources are processed one at a
# time and each branch is cut from the latest base, so merges are sequential and
# conflict-free. Run from the wiki repo root.
#
# If <tool_path> (the loop's event tool, {{TOOL_PATH}}) is given, the script EMITS
# merge.done with the real `merged=<base>` evidence itself — so the merger agent's only
# job is to run this one command, with no separate emit to fabricate or paraphrase and no
# "merge" task to do by hand. Without it, the script just prints the line (manual use).

set -eu
slug="${1:?usage: okf-source-merge.sh <slug> [tool_path] [source_url]}"
tool="${2:-}"
source="${3:-}"
base="$(cat .git/okf-base 2>/dev/null || echo main)"

git checkout -q "$base"
git merge -q --no-ff --no-edit -m "merge source: $slug" "source/$slug"
git branch -q -D "source/$slug"
sha="$(git rev-parse --short HEAD)"
echo "merged=$base commit=$sha"

# Self-emit merge.done with the real evidence (and source= so advance can complete the
# right task). The merger agent just runs this script — no emit to fabricate, no hand merge.
if [ -n "$tool" ]; then
  "$tool" emit merge.done "slug=$slug source=$source merged=$base commit=$sha"
fi
