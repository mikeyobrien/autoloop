#!/usr/bin/env bash
set -euo pipefail

# LLM-as-judge: semantic pass/fail evaluation via the pi CLI.
#
# Usage:
#   echo "<content>" | scripts/llm-judge.sh "<criteria>"
#   scripts/llm-judge.sh "<criteria>" "<content>"
#
# Output: JSON line — {"pass": true|false, "reason": "..."}
# Exit:   0 = pass, 1 = fail, 2 = judge error

criteria="${1:?Usage: llm-judge.sh '<criteria>' ['<content>']}"

if [[ $# -ge 2 ]]; then
  content="$2"
else
  content="$(cat)"
fi

if [[ -z "$content" ]]; then
  echo '{"pass": false, "reason": "empty content provided to judge"}' >&2
  exit 1
fi

prompt="$(cat <<PROMPT
You are an LLM judge. Evaluate the following content against the given criteria.
Return ONLY a single JSON object on one line: {"pass": true or false, "reason": "one sentence"}

Criteria: ${criteria}

Content to evaluate:
${content}
PROMPT
)"

# Invoke pi with the judge prompt. Use --no-stream for clean single-response output.
response="$(echo "$prompt" | pi --no-stream 2>/dev/null)" || {
  echo '{"pass": false, "reason": "pi invocation failed"}' >&2
  exit 2
}

# Extract the JSON object from the response (pi may wrap it in extra text).
json="$(echo "$response" | grep -o '{[^}]*"pass"[^}]*}' | head -1)" || {
  echo '{"pass": false, "reason": "could not parse judge response"}' >&2
  exit 2
}

echo "$json"

# Exit code: 0 if pass, 1 if fail.
if echo "$json" | grep -q '"pass": *true'; then
  exit 0
else
  exit 1
fi
