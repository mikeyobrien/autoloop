import { shellQuote, joinCsv } from "../utils.js";
import type { LoopContext } from "./index.js";

export function emitToolScript(loop: LoopContext): string {
  return (
    "#!/bin/sh\n" +
    "set -eu\n" +
    "export MINILOOPS_PROJECT_DIR=" + shellQuote(loop.paths.projectDir) + "\n" +
    "export MINILOOPS_JOURNAL_FILE=" + shellQuote(loop.paths.journalFile) + "\n" +
    "export MINILOOPS_EVENTS_FILE=" + shellQuote(loop.paths.journalFile) + "\n" +
    "export MINILOOPS_MEMORY_FILE=" + shellQuote(loop.paths.memoryFile) + "\n" +
    "export MINILOOPS_RUN_ID=" + shellQuote(loop.runtime.runId) + "\n" +
    "export MINILOOPS_COMPLETION_EVENT=" + shellQuote(loop.completion.event) + "\n" +
    "export MINILOOPS_REQUIRED_EVENTS=" + shellQuote(joinCsv(loop.completion.requiredEvents)) + "\n" +
    "export MINILOOPS_BIN=" + shellQuote(loop.paths.toolPath) + "\n" +
    'stdout_file=$(mktemp)\n' +
    'stderr_file=$(mktemp)\n' +
    "cleanup() {\n" +
    '  rm -f "$stdout_file" "$stderr_file"\n' +
    "}\n" +
    "trap cleanup EXIT\n" +
    'if ' + loop.runtime.selfCommand + ' "$@" >"$stdout_file" 2>"$stderr_file"; then\n' +
    "  status=0\n" +
    "else\n" +
    "  status=$?\n" +
    "fi\n" +
    'cat "$stderr_file" >&2\n' +
    'if [ "${1:-}" = "emit" ]; then\n' +
    "  inner=$(sed -n 's/^%{:exit_code => \\([0-9][0-9]*\\),.*$/\\1/p' \"$stdout_file\" | tail -n 1)\n" +
    '  if [ -n "$inner" ]; then\n' +
    '    exit "$inner"\n' +
    "  fi\n" +
    "fi\n" +
    'cat "$stdout_file"\n' +
    'exit "$status"\n'
  );
}

export function piAdapterScript(loop: LoopContext): string {
  return (
    "#!/bin/sh\n" +
    "set -eu\n" +
    "exec " + loop.runtime.selfCommand + ' pi-adapter "$@"\n'
  );
}
