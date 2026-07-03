#!/bin/sh
# okf-recapture.sh <url> <slug> <tier> [tool_path] — REFRESH an already-captured source.
#
# Used in refresh mode (AUTOWIKI_REFRESH set) when a source's URL may have changed upstream
# (e.g. Anthropic updates their docs). It re-captures the source onto a fresh branch (reusing
# okf-capture.sh, so .md and HTML are handled the same way), then compares the new clean-doc
# BODY against the committed one on base (frontmatter — incl. the `captured:` date — is ignored,
# so a byte-identical re-fetch is a true no-op):
#   * unchanged → discard the branch, mark the slug checked, emit `clean.unchanged` (advance
#                 just dispatches the next source — no merge, ~free).
#   * changed   → keep the branch + new commit, mark the slug checked, emit clean.<tier> with
#                 `updated=1`. The write role then runs `git diff <base>` on the clean doc to see
#                 exactly what changed and SURGICALLY updates the pages citing this source.
# Mirrors okf-source-merge.sh / okf-tombstone.sh: if <tool_path> is given the script EMITS the
# outcome itself, so the cleaner's only job is to run this one command. Run from the wiki root.

set -eu
url="${1:?usage: okf-recapture.sh <url> <slug> <tier> [tool_path]}"
slug="${2:?usage: okf-recapture.sh <url> <slug> <tier> [tool_path]}"
tier="${3:?usage: okf-recapture.sh <url> <slug> <tier> [tool_path]}"
tool="${4:-}"
here="$(dirname "$0")"
checked=".autoloop/refresh-checked"

# print just the body (everything after the 2nd `---` frontmatter fence). Once past the 2nd
# fence we print EVERY remaining line unconditionally — `---` horizontal rules inside the
# markdown body must NOT truncate the body (that would hide real changes below them).
strip_fm() { awk 'p{print; next} /^---$/{n++; if(n==2)p=1}'; }
body_of_file() { strip_fm < "$1"; }
body_of_ref()  { git show "$1" 2>/dev/null | strip_fm; }

base="$(cat .git/okf-base 2>/dev/null || git symbolic-ref --short HEAD)"
old_body="$(body_of_ref "$base:sources/clean/$slug.md")"

# Re-capture fresh onto source/<slug> (okf-capture cuts the branch, writes raw+clean, commits).
sh "$here/okf-capture.sh" "$url" "$slug" >/dev/null
new_body="$(body_of_file "sources/clean/$slug.md")"

mkdir -p .autoloop
printf '%s\n' "$slug" >> "$checked"   # mark re-checked this refresh pass (both outcomes)

if [ "$old_body" = "$new_body" ]; then
  # No real change — throw the branch away and go back to base.
  git checkout -q "$base"
  git branch -q -D "source/$slug" 2>/dev/null || true
  echo "changed=no"
  [ -n "$tool" ] && "$tool" emit clean.unchanged "slug=$slug source=$url"
else
  sha="$(git rev-parse --short HEAD)"
  echo "changed=yes commit=$sha"
  [ -n "$tool" ] && "$tool" emit "clean.$tier" "strategy=refresh source=$url slug=$slug updated=1 commit=$sha"
fi
