#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"

run_autoloops_clean() {
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
    echo "mock smoke tmpdir preserved at: $tmpdir" >&2
  fi
}
trap cleanup EXIT

cat > "$tmpdir/autoloops.toml" <<'EOF'
event_loop.max_iterations = 2
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
event_loop.required_events = []

backend.kind = "command"
backend.command = "./mock-backend.sh"
backend.timeout_ms = 180000

review.enabled = false

core.state_dir = ".autoloop"
core.journal_file = ".autoloop/journal.jsonl"
core.memory_file = ".autoloop/memory.jsonl"
EOF

cat > "$tmpdir/topology.toml" <<'EOF'
name = "mock-smoke"
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

cat > "$tmpdir/mock-backend.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'hello\n'
if [ -n "${MINILOOPS_BIN:-}" ]; then
  "$MINILOOPS_BIN" emit task.complete hello-done >/dev/null
else
  printf 'LOOP_COMPLETE\n'
fi
EOF
chmod +x "$tmpdir/mock-backend.sh"

run_output="$tmpdir/run.out"
(
  cd "$tmpdir"
  run_autoloops_clean timeout 240 tonic run "$repo_dir" . 'Smoke test: print exactly hello, then emit task.complete with payload hello-done.'
) | tee "$run_output"

journal="$tmpdir/.autoloop/journal.jsonl"
output_text="$(cd "$tmpdir" && run_autoloops_clean tonic run "$repo_dir" inspect output 1 . --format text)"

[[ -f "$journal" ]] || { echo "missing journal: $journal" >&2; exit 1; }
[[ "$output_text" == $'hello\n' || "$output_text" == "hello" ]] || {
  printf 'unexpected projected output: %q\n' "$output_text" >&2
  exit 1
}

rg -n '"topic": "backend.start"' "$journal" >/dev/null || { echo "missing backend.start" >&2; exit 1; }
rg -n '"backend_kind": "command"' "$journal" >/dev/null || { echo "missing backend_kind=command" >&2; exit 1; }
rg -n '"topic": "task.complete"' "$journal" >/dev/null || { echo "missing task.complete" >&2; exit 1; }
rg -n '"payload": "hello-done"' "$journal" >/dev/null || { echo "missing task.complete payload" >&2; exit 1; }
rg -n '"topic": "backend.finish"' "$journal" >/dev/null || { echo "missing backend.finish" >&2; exit 1; }
rg -n '"topic": "loop.complete"' "$journal" >/dev/null || { echo "missing loop.complete" >&2; exit 1; }
rg -n '"reason": "completion_event"' "$journal" >/dev/null || { echo "missing completion_event reason" >&2; exit 1; }

printf 'mock smoke: ok\n'
