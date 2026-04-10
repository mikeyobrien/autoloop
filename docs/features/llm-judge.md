# LLM Judge

`scripts/llm-judge.sh` is a small utility that performs semantic pass/fail evaluation by sending content and criteria to an LLM via the `pi` CLI. It is used by workflow roles (e.g. the autoresearch evaluator) that need a judgment call beyond hard metrics.

## Usage

The script accepts criteria as the first argument and content either as the second argument or via stdin:

```bash
# Pipe content
echo "<content>" | scripts/llm-judge.sh "<criteria>"

# Pass content as second argument
scripts/llm-judge.sh "<criteria>" "<content>"
```

From within a preset role prompt the path is relative to the preset directory:

```bash
echo "$output" | ../../scripts/llm-judge.sh "output is valid JSON with a 'status' field"
```

## Output

The script prints a single JSON line to stdout:

```json
{"pass": true, "reason": "one sentence explanation"}
```

Error messages (empty content, `pi` failure, unparseable response) are printed to stderr in the same JSON shape.

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Pass — the content satisfies the criteria |
| `1`  | Fail — the content does not satisfy the criteria, or content was empty |
| `2`  | Judge error — `pi` invocation failed or the response could not be parsed |

## How it works

1. Builds a prompt instructing the LLM to return a `{"pass": bool, "reason": "..."}` JSON object.
2. Sends the prompt to `pi --no-stream` and captures the response.
3. Extracts the first JSON object containing a `"pass"` key from the response.
4. Echoes the extracted JSON and exits with `0` (pass) or `1` (fail).

## Dependencies

The script requires the `pi` CLI to be available on `$PATH`. See the [`pi-adapter` subcommand](../reference/cli.md#pi-adapter) for details on how autoloops wraps `pi`.
