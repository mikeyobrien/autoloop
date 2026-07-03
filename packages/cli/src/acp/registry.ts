// Command registry — the single source of truth for the verbs that the ACP
// console exposes both as parseable prompt lines and as `/slashcommands`.
//
// Each entry describes one autoloop CLI verb. The `mode` field tells the ACP
// agent how to execute it:
//   - "stream": long-running (a loop). Executed via harness.run() with its
//     LoopEvent stream bridged onto ACP session/update notifications.
//   - "capture": quick/synchronous. Executed by invoking the existing CLI
//     dispatcher with stdout/stderr captured, returning the text as a final
//     agent_message_chunk.
//   - "control": handled directly by the agent (dashboard lifecycle), not by a
//     CLI dispatcher.
//
// The slash command surface (AvailableCommand[]) is generated from this table,
// so adding a verb here keeps the prompt parser and the slash list in sync.

export type CommandMode = "stream" | "capture" | "control";

/**
 * Preset used when a prompt is a bare objective rather than an explicit command
 * (e.g. the ACP client sends "build the login page"). Explicit verbs and
 * /slash commands always take priority over this default.
 */
export const DEFAULT_PRESET = "autocode";

export interface CommandSpec {
  /** Verb as typed on the prompt line and as the slash command name. */
  name: string;
  /** One-line description shown in the slash command list. */
  description: string;
  /** Placeholder hint shown by clients before the user types arguments. */
  hint: string;
  /** How the agent dispatches this verb. */
  mode: CommandMode;
}

/**
 * The ordered command table. `run` is intentionally first so it is the first
 * slash command presented to ACP clients.
 */
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "run",
    description: 'Start a loop with a preset (e.g. run autocode "Fix bug")',
    hint: "<preset> [objective] [flags]",
    mode: "stream",
  },
  {
    name: "chain",
    description: "Run or list chains of presets",
    hint: "<list|run> [args]",
    mode: "stream",
  },
  {
    name: "loops",
    description: "List active/recent runs or show/health a run",
    hint: "[--all|show <id>|artifacts <id>|health]",
    mode: "capture",
  },
  {
    name: "inspect",
    description: "Inspect a run artifact (journal, scratchpad, metrics, ...)",
    hint: "<artifact> [selector] [--format <fmt>]",
    mode: "capture",
  },
  {
    name: "guide",
    description: "Inject operator guidance into the next iteration of a run",
    hint: "[--run <id>] <message>",
    mode: "capture",
  },
  {
    name: "list",
    description: "List available presets",
    hint: "",
    mode: "capture",
  },
  {
    name: "memory",
    description: "Manage persistent loop memory",
    hint: "<list|status|find|add|remove> [args]",
    mode: "capture",
  },
  {
    name: "task",
    description: "Manage loop tasks",
    hint: "<add|complete|update|remove|list> [args]",
    mode: "capture",
  },
  {
    name: "worktree",
    description: "Manage git worktrees for isolated runs",
    hint: "<list|show|merge|clean> [args]",
    mode: "capture",
  },
  {
    name: "runs",
    description: "Maintain run directories",
    hint: "clean [--max-age <days>]",
    mode: "capture",
  },
  {
    name: "config",
    description: "Show or edit autoloop configuration",
    hint: "<show|set|unset|path> [args]",
    mode: "capture",
  },
  {
    name: "control",
    description: "Inspect or control a live run",
    hint: "<show|capabilities|interrupt|guide> <id>",
    mode: "capture",
  },
  {
    name: "emit",
    description: "Emit a coordination topic event into a run",
    hint: "<topic> [summary]",
    mode: "capture",
  },
  {
    name: "dashboard",
    description: "Start/stop the local dashboard and return its URL",
    hint: "[start|stop|status] [--port <port>] [--host <host>]",
    mode: "control",
  },
] as const;

const COMMAND_BY_NAME = new Map<string, CommandSpec>(
  COMMANDS.map((c) => [c.name, c]),
);

export interface ParsedCommand {
  spec: CommandSpec;
  /** Argument tokens after the verb. */
  args: string[];
}

/**
 * Parse a prompt line into a command + args. Accepts both bare verbs
 * (`run autocode ...`) and slash form (`/run autocode ...`). Returns null when
 * the line is empty or the leading token is not a known command.
 */
export function parseCommandLine(line: string): ParsedCommand | null {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;
  let head = tokens[0];
  if (head.startsWith("/")) head = head.slice(1);
  const spec = COMMAND_BY_NAME.get(head);
  if (!spec) return null;
  return { spec, args: tokens.slice(1) };
}

/**
 * Normalize raw prompt text before parsing. ACP clients (especially when driven
 * by a model) sometimes wrap the prompt in an XML-like envelope such as
 * `<user_message>…</user_message>`. Strip a single outer wrapper of a few known
 * tag names so the inner command/objective is what we parse. Unrecognized tags
 * are left untouched.
 */
export function normalizePromptText(raw: string): string {
  let text = raw.trim();
  const wrappers = ["user_message", "user", "message", "query", "prompt"];
  for (const tag of wrappers) {
    const open = new RegExp(`^<${tag}(?:\\s[^>]*)?>`, "i");
    const close = new RegExp(`</${tag}>$`, "i");
    if (open.test(text) && close.test(text)) {
      text = text.replace(open, "").replace(close, "").trim();
      break;
    }
  }
  return text;
}

/**
 * Tokenize a command line honoring single/double quotes so objectives with
 * spaces survive (e.g. `run autocode "Fix the login bug"`).
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}
