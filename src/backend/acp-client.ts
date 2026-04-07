import { type ChildProcess, spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";

export interface AcpClientOptions {
  command: string;
  args: string[];
  cwd: string;
  trustAllTools: boolean;
  agentName?: string;
  modelId?: string;
  verbose?: boolean;
}

export interface AcpSession {
  sessionId: string;
  connection: acp.ClientSideConnection;
  process: ChildProcess;
  textBuffer: string;
  stderrBuffer: string;
  options: AcpClientOptions;
  /** Resolves when the child process exits — used to race against hanging prompts */
  closed: Promise<{ code: number | null; signal: string | null }>;
}

export interface AcpPromptResult {
  output: string;
  stopReason: acp.StopReason;
  timedOut: boolean;
  error?: string;
}

/**
 * Format an ACP SessionUpdate for verbose stderr output.
 * Returns null for event types that should be silenced.
 */
export function formatStreamingUpdate(
  update: acp.SessionUpdate,
): string | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content?.type === "text" ? update.content.text : null;
    case "agent_thought_chunk":
      return update.content?.type === "text"
        ? `[thinking] ${update.content.text}\n`
        : null;
    case "tool_call":
      return `[tool:${update.kind ?? "other"}] ${update.title}\n`;
    case "tool_call_update":
      if (update.status === "completed")
        return `[tool:✓] ${update.title ?? ""}\n`;
      if (update.status === "failed") return `[tool:✗] ${update.title ?? ""}\n`;
      return null;
    default:
      return null;
  }
}

export async function initAcpSession(
  opts: AcpClientOptions,
): Promise<AcpSession> {
  const child = spawn(opts.command, opts.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: opts.cwd,
    env: process.env,
    detached: true, // create own process group so process.kill(-pid) in terminateAcpSession kills the full tree
  });

  if (!child.stdout || !child.stdin) {
    throw new Error("Failed to create ACP process stdio streams");
  }

  const session: AcpSession = {
    sessionId: "",
    connection: null as unknown as acp.ClientSideConnection,
    process: child,
    textBuffer: "",
    stderrBuffer: "",
    options: opts,
    closed: null as unknown as Promise<{
      code: number | null;
      signal: string | null;
    }>,
  };

  // Buffer stderr for diagnostics
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      session.stderrBuffer += chunk.toString();
    });
  }

  // Track process exit so hanging prompts can bail out
  session.closed = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  // Build transport: manual NDJSON parsing on stdout (more reliable), SDK serialization on stdin
  const stdin = child.stdin;
  const stdout = child.stdout;

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      if (stdin.destroyed || stdin.writableEnded) return;
      return new Promise<void>((resolve, reject) => {
        stdin.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
    close() {
      stdin.end();
    },
    abort(reason) {
      stdin.destroy(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    },
  });

  let buffer = "";
  const decoder = new TextDecoder();
  let msgController: ReadableStreamDefaultController<unknown>;
  const parsedMessages = new ReadableStream<unknown>({
    start(controller) {
      msgController = controller;
    },
    cancel() {
      stdout.destroy();
    },
  });

  stdout.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const msg = JSON.parse(trimmed);
          // Filter kiro-cli private notifications — the ACP SDK doesn't know about
          // _kiro.dev/* methods and responds with -32601 "Method not found".
          // These are private kiro-cli extensions the ACP SDK does not handle.
          if (
            msg.method &&
            typeof msg.method === "string" &&
            msg.method.startsWith("_kiro.dev/")
          ) {
            continue;
          }
          msgController.enqueue(msg);
        } catch {
          /* skip malformed */
        }
      }
    }
  });
  stdout.on("end", () => {
    if (buffer.trim()) {
      try {
        msgController.enqueue(JSON.parse(buffer.trim()));
      } catch {
        /* skip */
      }
    }
    msgController.close();
  });
  stdout.on("error", (err) => {
    msgController.error(err);
  });

  // Use ndJsonStream only for writable serialization; readable is our manual parser
  const dummyReadable = new ReadableStream<Uint8Array>({ start() {} });
  const ndJson = acp.ndJsonStream(writable, dummyReadable);
  const stream: acp.Stream = {
    readable: parsedMessages as ReadableStream<acp.AnyMessage>,
    writable: ndJson.writable,
  };

  const client: acp.Client = {
    async requestPermission(
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> {
      if (opts.trustAllTools && params.options?.length) {
        const allow =
          params.options.find((o) => o.kind === "allow_always") ??
          params.options.find((o) => o.kind === "allow_once");
        if (allow)
          return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      const { update } = params;
      if (!update) return;
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text"
      ) {
        session.textBuffer += update.content.text;
      }
      if (opts.verbose) {
        const line = formatStreamingUpdate(update);
        if (line) process.stderr.write(line);
      }
    },
  };

  session.connection = new acp.ClientSideConnection(() => client, stream);

  // Initialize
  await session.connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: "autoloop", version: "0.1.0" },
  });

  // Create session
  const result = await session.connection.newSession({
    cwd: opts.cwd,
    mcpServers: [],
  });
  session.sessionId = result.sessionId;

  // Optionally set mode/model
  if (opts.agentName) {
    await session.connection.setSessionMode({
      sessionId: session.sessionId,
      modeId: opts.agentName,
    });
  }
  if (opts.modelId) {
    await session.connection.unstable_setSessionModel({
      sessionId: session.sessionId,
      modelId: opts.modelId,
    });
  }

  return session;
}

export async function sendAcpPrompt(
  session: AcpSession,
  prompt: string,
  timeoutMs: number,
): Promise<AcpPromptResult> {
  session.textBuffer = "";

  // Retry with backoff if agent isn't idle yet
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendAcpPromptOnce(session, prompt, timeoutMs);
    } catch (err: any) {
      if (err.message?.includes("not idle") && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
  // unreachable, but satisfies TS
  return {
    output: session.textBuffer,
    stopReason: "end_turn",
    timedOut: false,
    error: "retry exhausted",
  };
}

async function sendAcpPromptOnce(
  session: AcpSession,
  prompt: string,
  timeoutMs: number,
): Promise<AcpPromptResult> {
  session.textBuffer = "";

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      session.connection.cancel({ sessionId: session.sessionId });
      reject(new Error("ACP prompt timed out"));
    }, timeoutMs);
  });

  // Detect process crash mid-prompt
  const crashPromise = session.closed.then(({ code, signal }) => {
    const stderr = session.stderrBuffer.trim();
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(
      `kiro-cli exited unexpectedly: code=${code} signal=${signal}${detail}`,
    );
  });

  try {
    const response = await Promise.race([
      session.connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: prompt }],
      }),
      timeoutPromise,
      crashPromise,
    ]);
    clearTimeout(timer);
    return {
      output: session.textBuffer,
      stopReason: response.stopReason,
      timedOut: false,
    };
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) {
      return {
        output: session.textBuffer,
        stopReason: "cancelled",
        timedOut: true,
      };
    }
    return {
      output: session.textBuffer,
      stopReason: "end_turn",
      timedOut: false,
      error: String(err),
    };
  }
}

export async function terminateAcpSession(session: AcpSession): Promise<void> {
  const child = session.process;
  if (!child.pid || child.killed) return;

  // Cancel any in-flight turn before killing
  try {
    session.connection.cancel({ sessionId: session.sessionId });
  } catch {
    /* may not have a session */
  }

  // Kill the entire process tree — MCP servers run in their own process groups
  // and won't die from just killing the parent.
  const pid = child.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* process group may not exist */
  }
  child.kill("SIGTERM");

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && !child.killed) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already dead */
    }
    child.kill("SIGKILL");
  }
}
