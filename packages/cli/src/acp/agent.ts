// AutoloopAgent — the ACP agent (server) implementation.
//
// `autoloop acp` runs this over stdio so a parent process (editor, harness, or
// another agent) can drive autoloop through the Agent Client Protocol. It is a
// persistent console: one session lives for the life of the connection and can
// launch many runs and quick commands over successive prompt turns.
//
// Prompt turns are dispatched by parsing the prompt text as an autoloop command
// line (the same verbs available on the CLI), also surfaced as /slashcommands
// via availableCommands. Long-running verbs (run/chain) stream their LoopEvents
// as ACP tool calls; quick verbs return captured text; dashboard start/stop
// returns a clickable URL.

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { DashboardControl } from "./dashboard-control.js";
import type { SessionUpdateSink } from "./event-bridge.js";
import { runQuickCommand } from "./quick.js";
import { COMMANDS, parseCommandLine } from "./registry.js";
import { executeRun } from "./run-exec.js";

export interface AgentDeps {
  bundleRoot: string;
  selfCmd: string;
  projectDir: string;
  verbose?: boolean;
}

interface SessionState {
  /** Project directory for this session (from session/new cwd). */
  projectDir: string;
  /** Abort controller for the in-flight prompt turn, if any. */
  activeTurn: AbortController | null;
}

export class AutoloopAgent implements acp.Agent {
  private readonly conn: acp.AgentSideConnection;
  private readonly deps: AgentDeps;
  private readonly sessions = new Map<string, SessionState>();
  private readonly dashboard: DashboardControl;

  constructor(conn: acp.AgentSideConnection, deps: AgentDeps) {
    this.conn = conn;
    this.deps = deps;
    this.dashboard = new DashboardControl({
      bundleRoot: deps.bundleRoot,
      selfCmd: deps.selfCmd,
      projectDir: deps.projectDir,
    });
  }

  /** Stop the dashboard and abort any active turns. Call on disconnect. */
  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.activeTurn?.abort();
    }
    await this.dashboard.shutdown();
  }

  async initialize(
    params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    const protocolVersion =
      params.protocolVersion <= acp.PROTOCOL_VERSION
        ? params.protocolVersion
        : acp.PROTOCOL_VERSION;
    return {
      protocolVersion,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "autoloop", version: "0.1.0" },
    };
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    const sessionId = `autoloop-${randomUUID()}`;
    this.sessions.set(sessionId, {
      // The ACP client sets the working directory via session/new `cwd`;
      // fall back to the launch-time --project-dir default.
      projectDir: params.cwd
        ? resolve(params.cwd)
        : resolve(this.deps.projectDir),
      activeTurn: null,
    });
    // Advertise the available commands as slash commands.
    await this.conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: COMMANDS.map((c) => ({
          name: c.name,
          description: c.description,
          input: { hint: c.hint },
        })),
      },
    });
    return { sessionId };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return { stopReason: "refusal" };
    }

    const text = extractText(params.prompt).trim();
    const parsed = parseCommandLine(text);
    if (!parsed) {
      await this.sendMessage(params.sessionId, helpText(text));
      return { stopReason: "end_turn" };
    }

    const { spec, args } = parsed;

    if (spec.mode === "control") {
      return this.handleDashboard(params.sessionId, session, args);
    }

    if (spec.mode === "capture") {
      return this.handleQuick(params.sessionId, session, spec.name, args);
    }

    return this.handleStream(params.sessionId, session, spec.name, args);
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.activeTurn?.abort();
  }

  async authenticate(
    _params: acp.AuthenticateRequest,
  ): Promise<acp.AuthenticateResponse> {
    // autoloop runs locally under the caller's own credentials; no ACP-level
    // authentication is required, so we acknowledge with an empty response.
    return {};
  }

  // ---- dispatch helpers -------------------------------------------------

  private async handleDashboard(
    sessionId: string,
    session: SessionState,
    args: string[],
  ): Promise<acp.PromptResponse> {
    const result = await this.dashboard.dispatch(args, session.projectDir);
    // Emit the URL on its own line so clients can linkify it.
    const body = result.url
      ? `${result.message}\n${result.url}`
      : result.message;
    await this.sendMessage(sessionId, body);
    return { stopReason: result.ok ? "end_turn" : "refusal" };
  }

  private async handleQuick(
    sessionId: string,
    session: SessionState,
    name: string,
    args: string[],
  ): Promise<acp.PromptResponse> {
    try {
      const captured = await withProjectDir(session.projectDir, () =>
        runQuickCommand(name, args, {
          bundleRoot: this.deps.bundleRoot,
          selfCmd: this.deps.selfCmd,
          projectDir: session.projectDir,
        }),
      );
      const text =
        [captured.stdout, captured.stderr].filter((s) => s.trim()).join("\n") ||
        `(${name} produced no output)`;
      await this.sendMessage(sessionId, text);
      return { stopReason: "end_turn" };
    } catch (err) {
      await this.sendMessage(
        sessionId,
        `Error running ${name}: ${errText(err)}`,
      );
      return { stopReason: "refusal" };
    }
  }

  private async handleStream(
    sessionId: string,
    session: SessionState,
    name: string,
    args: string[],
  ): Promise<acp.PromptResponse> {
    const abort = new AbortController();
    session.activeTurn = abort;
    const sink: SessionUpdateSink = {
      update: (update) =>
        this.conn.sessionUpdate({
          sessionId,
          update: update as acp.SessionUpdate,
        }),
    };
    try {
      const result = await executeRun(name, args, {
        bundleRoot: this.deps.bundleRoot,
        selfCmd: this.deps.selfCmd,
        projectDir: session.projectDir,
        signal: abort.signal,
        sink,
        toolCallId: `run-${randomUUID()}`,
        verbose: this.deps.verbose,
      });
      await this.sendMessage(sessionId, result.summary);
      return { stopReason: result.stopReason };
    } catch (err) {
      await this.sendMessage(sessionId, `Run error: ${errText(err)}`);
      return { stopReason: "refusal" };
    } finally {
      session.activeTurn = null;
    }
  }

  private async sendMessage(sessionId: string, text: string): Promise<void> {
    await this.conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }
}

function extractText(blocks: acp.PromptRequest["prompt"]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

function helpText(input: string): string {
  const lines = [
    input ? `Unknown command: ${input}` : "Enter a command.",
    "",
    "Available commands (also usable as /slash):",
    ...COMMANDS.map((c) => `  ${c.name} ${c.hint} — ${c.description}`),
  ];
  return lines.join("\n");
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run `fn` with AUTOLOOP_PROJECT_DIR set to `dir`, restoring the previous value
 * afterward. This is the single lever the quick CLI dispatchers, `guide`, and
 * `emit` already honor to locate the project, so setting it per turn makes the
 * session's project directory authoritative without per-command plumbing.
 * Turns are serialized (one active turn per session), so there is no env race.
 */
async function withProjectDir<T>(
  dir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env.AUTOLOOP_PROJECT_DIR;
  process.env.AUTOLOOP_PROJECT_DIR = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AUTOLOOP_PROJECT_DIR;
    else process.env.AUTOLOOP_PROJECT_DIR = prev;
  }
}
