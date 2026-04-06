import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { shellWords } from "./utils.js";

const BRIDGE_SCRIPT = `
import json
import os
import pathlib
import subprocess
import sys


def extract_text_from_message(message):
    text_parts = []
    for item in message.get("content") or []:
        if item.get("type") == "text":
            text_parts.append(item.get("text", ""))
    return "".join(text_parts)


def extract_text_from_messages(messages):
    if not messages:
        return ""
    return extract_text_from_message(messages[-1] or {})


def extract_tool_error(response):
    for item in response.get("output") or []:
        if item.get("type") == "text":
            text = item.get("text", "")
            if text:
                return text
    return ""


def stream_log_path():
    state_dir = os.environ.get("AUTOLOOP_STATE_DIR", "")
    if not state_dir:
        return None
    prefix = "pi-review" if os.environ.get("AUTOLOOP_REVIEW_MODE", "") == "hyperagent" else "pi-stream"
    iteration = os.environ.get("AUTOLOOP_ITERATION", "")
    name = prefix + (("." + iteration) if iteration else "") + ".jsonl"
    return pathlib.Path(state_dir) / name


cmd = sys.argv[1:-1]
prompt_path = sys.argv[-1]
raw_output = ""
exit_code = 1

try:
    with open(prompt_path, "r", encoding="utf-8") as prompt_file:
        completed = subprocess.run(cmd, stdin=prompt_file, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    raw_output = completed.stdout or ""
    exit_code = completed.returncode
except FileNotFoundError as exc:
    raw_output = str(exc)
    exit_code = 127

log_path = stream_log_path()
if log_path is not None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(raw_output)

text_parts = []
fallback_text = ""
saw_turn_end = False
saw_agent_end = False
error = ""

for raw_line in raw_output.splitlines():
    line = raw_line.strip()
    if not line:
        continue

    try:
        event = json.loads(line)
    except Exception:
        continue

    event_type = event.get("type")

    if event_type == "message_update":
        assistant_event = event.get("assistantMessageEvent") or {}
        assistant_type = assistant_event.get("type")
        if assistant_type == "text_delta":
            text_parts.append(assistant_event.get("delta", ""))
        elif assistant_type == "error" and assistant_event.get("reason"):
            error = assistant_event.get("reason")
    elif event_type == "tool_execution_end":
        response = event.get("toolExecutionResponseEvent") or {}
        if response.get("isError"):
            detail = extract_tool_error(response)
            if detail:
                error = detail
    elif event_type == "turn_end":
        saw_turn_end = True
        if not fallback_text:
            fallback_text = extract_text_from_message(event.get("message") or {})
    elif event_type == "agent_end":
        saw_agent_end = True
        if not fallback_text:
            fallback_text = extract_text_from_messages(event.get("messages") or [])

text = "".join(text_parts)
if not text:
    text = fallback_text

failed = exit_code != 0 or (not saw_turn_end and not saw_agent_end) or bool(error)
verbose = os.environ.get("AUTOLOOP_LOG_LEVEL", "") == "debug"
output = ""

if failed:
    if verbose:
        if text and error:
            output = text + "\\n\\npi error: " + error
        elif text:
            output = text
        else:
            output = raw_output or error
    else:
        if text:
            output = text
        elif error:
            output = "pi failed (run with -v for details)"
        else:
            output = raw_output or "pi failed"
else:
    output = text

if output:
    sys.stdout.write(output)

sys.exit(1 if failed else 0)
`;

export function run(args: string[]): void {
  const prompt = resolvePrompt();
  if (!prompt) {
    finishFailure("missing projected prompt");
    return;
  }

  const promptPath = materializePromptPath(prompt);
  const piCommand = args[0] || "pi";
  const piArgs = args.slice(1);
  const command = buildPiBridgeCommand(piCommand, piArgs, promptPath);

  try {
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/sh",
      maxBuffer: 100 * 1024 * 1024,
    });
    finishSuccess(output || "");
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    finishFailure(e.stdout || e.stderr || "");
  }
}

function resolvePrompt(): string {
  const envPrompt = process.env.AUTOLOOP_PROMPT;
  if (envPrompt) return envPrompt;

  const pathPrompt = promptFromPath();
  if (pathPrompt) return pathPrompt;

  return projectedPrompt();
}

function projectedPrompt(): string {
  const bin = process.env.AUTOLOOP_BIN || "";
  const iteration = process.env.AUTOLOOP_ITERATION || "";
  if (!bin || !iteration) return "";

  try {
    const output = execSync(
      shellWords([bin, "inspect", "prompt", iteration, "--format", "md"]),
      { encoding: "utf-8", shell: "/bin/sh", timeout: 30000 },
    );
    return output || "";
  } catch {
    return "";
  }
}

function promptFromPath(): string {
  const path = process.env.AUTOLOOP_PROMPT_PATH || "";
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function buildPiBridgeCommand(
  command: string,
  extraArgs: string[],
  promptPath: string,
): string {
  return shellWords([
    "python3",
    "-c",
    BRIDGE_SCRIPT,
    command,
    ...defaultPiArgs(),
    ...extraArgs,
    promptPath,
  ]);
}

function materializePromptPath(prompt: string): string {
  const path = promptStoragePath();
  writeFileSync(path, prompt, "utf-8");
  return path;
}

function promptStoragePath(): string {
  const configured = process.env.AUTOLOOP_PROMPT_PATH || "";
  return configured || "/tmp/autoloop-pi-adapter-prompt.md";
}

function defaultPiArgs(): string[] {
  return ["-p", "--mode", "json", "--no-session"];
}

function finishSuccess(output: string): void {
  if (output) process.stdout.write(output);
  process.exitCode = 0;
}

function finishFailure(output: string): void {
  if (output) process.stdout.write(output);
  process.exitCode = 1;
}
