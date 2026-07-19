#!/bin/sh
set -eu

case "${AUTOLOOP_ITERATION:-}" in
  1)
    "$AUTOLOOP_BIN" emit first.done "route to the second fixture role"
    ;;
  2)
    "$AUTOLOOP_BIN" emit task.complete "second fixture role completed"
    ;;
  *)
    printf 'Unexpected fixture iteration: %s\n' "${AUTOLOOP_ITERATION:-unset}" >&2
    exit 1
    ;;
esac
