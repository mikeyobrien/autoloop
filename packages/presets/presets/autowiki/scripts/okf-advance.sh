#!/bin/sh
# okf-advance.sh <trigger> <tool_path> — the deterministic queue keeper. The `advance` role
# just runs this one script; the script computes the queue state and EMITS the next event
# itself (like okf-source-merge.sh). This exists because asking the agent to "count the queue
# and decide" was unreliable — it miscounted and ended the run early. Determinism over prompting.
#
#   <trigger>   what activated advance, one of:
#                 loop_start  — first turn (vault already bootstrapped by okf-init)
#                 merge       — a source just merged (merge.done)
#                 skip        — a refreshed source was UNCHANGED (clean.unchanged); dispatch next
#                 maint_done  — a maintenance batch just finished (index.done)
#   <tool_path> the loop's event tool ({{TOOL_PATH}}) — used to emit.
#
# The QUEUE LEDGER is okf-pending.sh: it lists sources still lacking a committed
# sources/clean/<slug>.md (base tier first), so "pending" shrinks by one each time a source
# merges to base — no separate per-run task store to drift out of sync. MAINTENANCE CADENCE:
# a counter in .autoloop/okf-advance.state tracks merges since the last maintenance batch; we
# run a batch every 5 merges, and always once when the queue drains (final pass). Run from the
# wiki repo root, on the base branch.

set -eu
trigger="${1:?usage: okf-advance.sh <loop_start|merge|maint_done> <tool_path>}"
tool="${2:?usage: okf-advance.sh <trigger> <tool_path>}"
here="$(dirname "$0")"
state=".autoloop/okf-advance.state"
every=5

pending_lines() { sh "$here/okf-pending.sh"; }
pending_count() { pending_lines | grep -c . || true; }

dispatch() {
  line="$(pending_lines | head -1)"
  url="$(printf '%s' "$line" | sed 's/ *tier=.*$//')"
  tier="$(printf '%s' "$line" | sed -n 's/.* tier=\([a-z]*\).*/\1/p')"
  [ -n "$tier" ] || tier=tip
  slug="$(sh "$here/okf-slug.sh" "$url")"
  open="$(pending_count)"
  "$tool" emit queue.advance "next=$url slug=$slug tier=$tier remaining=$open"
}

case "$trigger" in
  loop_start)
    echo 0 > "$state"
    : > ".autoloop/refresh-checked"   # reset the per-pass refresh marker (used in refresh mode)
    if [ "$(pending_count)" -gt 0 ]; then dispatch; else "$tool" emit queue.done "done=0"; fi
    ;;
  merge)
    n=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 ))
    pend="$(pending_count)"
    if [ "$pend" -eq 0 ]; then
      echo 0 > "$state"
      "$tool" emit maintenance.due "reason=final"
    elif [ "$n" -ge "$every" ]; then
      echo 0 > "$state"
      "$tool" emit maintenance.due "reason=checkpoint pending=$pend"
    else
      echo "$n" > "$state"
      dispatch
    fi
    ;;
  skip)
    # a source was re-checked and UNCHANGED (refresh mode, clean.unchanged): no merge, no
    # counter bump. Dispatch the next; if the queue is now drained, run a final maintenance
    # batch only if some updates merged this pass (counter>0), else just finish.
    if [ "$(pending_count)" -gt 0 ]; then
      dispatch
    elif [ "$(cat "$state" 2>/dev/null || echo 0)" -gt 0 ]; then
      echo 0 > "$state"; "$tool" emit maintenance.due "reason=final"
    else
      "$tool" emit queue.done "done=no-changes"
    fi
    ;;
  maint_done)
    if [ "$(pending_count)" -gt 0 ]; then dispatch; else "$tool" emit queue.done "done=all"; fi
    ;;
  *)
    echo "okf-advance: unknown trigger '$trigger'" >&2; exit 2
    ;;
esac
