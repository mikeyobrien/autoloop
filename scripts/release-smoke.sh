#!/usr/bin/env bash
set -euo pipefail

binary_path="${1:-}"

if [[ -z "$binary_path" ]]; then
  echo "Usage: scripts/release-smoke.sh <compiled-binary>" >&2
  exit 1
fi

if [[ ! -x "$binary_path" ]]; then
  echo "error: compiled binary is missing or not executable: $binary_path" >&2
  exit 1
fi

help_output="$($binary_path --help)"

[[ -n "$help_output" ]] || {
  echo "error: compiled binary produced empty help output" >&2
  exit 1
}

grep -q 'miniloops — autonomous LLM loop harness' <<<"$help_output" || {
  echo "error: compiled binary help output did not contain the expected banner" >&2
  exit 1
}

grep -q 'miniloops run <preset-name|preset-dir>' <<<"$help_output" || {
  echo "error: compiled binary help output did not contain run usage" >&2
  exit 1
}

printf 'release smoke: ok\n'
