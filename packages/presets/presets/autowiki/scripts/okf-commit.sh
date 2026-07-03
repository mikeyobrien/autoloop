#!/bin/sh
# okf-commit.sh <label> <slug> — stage all wiki changes and commit as "<label>: <slug>",
# printing the short sha. Used by the cleaner's github path (label `clean`), the foundation
# builder (`foundation`), the knowledge extractor (`extract`), the summarizer (`summarize`),
# the synthesizer (`synthesize`), the comparator (`compare`), the linter (`lint`), and the
# indexer (`index`). The label is a fixed word and
# the slug is deterministic (okf-slug.sh), so commit messages are uniform and not subject
# to agent phrasing drift.
#
# The OKF pre-commit hook still gates the commit (a Markdown file missing non-empty `type`
# frontmatter fails it). Run from the wiki repo root. okf-init.sh gitignores run state
# (.autoloop/), the ./scripts copies, and operational junk (*.out/*.log/.DS_Store), so
# `git add -A` only stages real vault content.

set -eu
label="${1:?usage: okf-commit.sh <label> <slug>}"
slug="${2:?usage: okf-commit.sh <label> <slug>}"

git add -A
if git diff --cached --quiet; then
  echo "okf-commit: nothing to commit"
  echo "commit=none"
  exit 0
fi
git commit -q -m "$label: $slug"
echo "commit=$(git rev-parse --short HEAD)"
