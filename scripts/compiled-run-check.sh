#!/usr/bin/env bash
set -euo pipefail

binary_path="${1:-}"

if [[ -z "$binary_path" ]]; then
  echo "Usage: scripts/compiled-run-check.sh <compiled-binary>" >&2
  exit 1
fi

if [[ ! -x "$binary_path" ]]; then
  echo "error: compiled binary is missing or not executable: $binary_path" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"

run_miniloops_clean() {
  env \
    -u MINILOOPS_PROJECT_DIR \
    -u MINILOOPS_STATE_DIR \
    -u MINILOOPS_JOURNAL_FILE \
    -u MINILOOPS_EVENTS_FILE \
    -u MINILOOPS_MEMORY_FILE \
    -u MINILOOPS_RUN_ID \
    -u MINILOOPS_ITERATION \
    -u MINILOOPS_RECENT_EVENT \
    -u MINILOOPS_ALLOWED_ROLES \
    -u MINILOOPS_ALLOWED_EVENTS \
    -u MINILOOPS_COMPLETION_EVENT \
    -u MINILOOPS_COMPLETION_PROMISE \
    -u MINILOOPS_REQUIRED_EVENTS \
    -u MINILOOPS_PROMPT \
    -u MINILOOPS_BIN \
    "$@"
}

cleanup() {
  status=$?
  if [[ $status -eq 0 ]]; then
    rm -rf "$tmpdir"
  else
    echo "compiled run check tmpdir preserved at: $tmpdir" >&2
  fi
}
trap cleanup EXIT

cat > "$tmpdir/miniloops.toml" <<'EOF'
event_loop.max_iterations = 2
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = []

backend.kind = "pi"
backend.command = "pi"
backend.timeout_ms = 180000

review.enabled = false

core.state_dir = ".miniloop"
core.journal_file = ".miniloop/journal.jsonl"
core.memory_file = ".miniloop/memory.jsonl"
EOF

cat > "$tmpdir/topology.toml" <<'EOF'
name = "compiled-run-check"
completion = "task.complete"

[[role]]
id = "planner"
emits = ["task.complete"]
prompt_file = "roles/planner.md"

[handoff]
"loop.start" = ["planner"]
EOF

mkdir -p "$tmpdir/roles"
cat > "$tmpdir/roles/planner.md" <<'EOF'
You are running a smoke test. Do the minimum.
- Print exactly: hello
- Emit task.complete with payload: hello-done
- Do not emit any other event.
EOF

cat > "$tmpdir/harness.md" <<'EOF'
Keep the turn tiny. Finish in one iteration.
EOF

status=0
(
  cd "$tmpdir"
  run_miniloops_clean timeout 240 "$binary_path" run . 'Smoke test: print exactly hello, then emit task.complete with payload hello-done.'
) >"$tmpdir/run.out" 2>"$tmpdir/run.err" || status=$?

if [[ $status -ne 0 ]]; then
  if grep -Fq 'unknown host function: str_length' "$tmpdir/run.err"; then
    echo 'compiled run check: reproduced unknown host function: str_length' >&2
    exit 2
  fi

  cat "$tmpdir/run.err" >&2
  exit "$status"
fi

journal="$tmpdir/.miniloop/journal.jsonl"
stream="$tmpdir/.miniloop/pi-stream.1.jsonl"
output_text="$(cd "$tmpdir" && run_miniloops_clean "$binary_path" inspect output 1 . --format text)"

[[ -f "$journal" ]] || { echo "missing journal: $journal" >&2; exit 1; }
[[ -f "$stream" ]] || { echo "missing Pi stream log: $stream" >&2; exit 1; }
[[ "$output_text" == $'hello\n' || "$output_text" == "hello" ]] || {
  printf 'unexpected projected output: %q\n' "$output_text" >&2
  exit 1
}

grep -F '"topic": "backend.start"' "$journal" >/dev/null || { echo "missing backend.start" >&2; exit 1; }
grep -F '"backend_kind": "pi"' "$journal" >/dev/null || { echo "missing backend_kind=pi" >&2; exit 1; }
grep -F '"topic": "task.complete"' "$journal" >/dev/null || { echo "missing task.complete" >&2; exit 1; }
grep -F '"payload": "hello-done"' "$journal" >/dev/null || { echo "missing task.complete payload" >&2; exit 1; }
grep -F '"topic": "backend.finish"' "$journal" >/dev/null || { echo "missing backend.finish" >&2; exit 1; }
grep -F '"topic": "loop.complete"' "$journal" >/dev/null || { echo "missing loop.complete" >&2; exit 1; }
grep -F '"reason": "completion_event"' "$journal" >/dev/null || { echo "missing completion_event reason" >&2; exit 1; }

echo 'compiled run check: ok'
