#!/bin/sh
set -eu

iteration="${MINILOOPS_ITERATION:-1}"
prompt="${MINILOOPS_PROMPT:-}"

if [ -z "$prompt" ] && [ -n "${MINILOOPS_BIN:-}" ]; then
  prompt="$($MINILOOPS_BIN inspect prompt "$iteration" --format md)"
fi

if [ -z "$prompt" ] && [ -n "${MINILOOPS_PROMPT_PATH:-}" ] && [ -f "$MINILOOPS_PROMPT_PATH" ]; then
  prompt=$(cat "$MINILOOPS_PROMPT_PATH")
fi

printf 'Iteration %s\n' "$iteration"
printf 'Prompt bytes: %s\n' "$(printf '%s' "$prompt" | wc -c | tr -d ' ')"

if [ "$iteration" -ge 2 ]; then
  if [ -n "${MINILOOPS_BIN:-}" ] && [ -n "${MINILOOPS_COMPLETION_EVENT:-}" ]; then
    "$MINILOOPS_BIN" emit "$MINILOOPS_COMPLETION_EVENT" "Status: done"
  else
    printf 'LOOP_COMPLETE\n'
  fi

  printf 'Status: done\n'
else
  printf 'Status: working\n'
fi
