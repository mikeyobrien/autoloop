import * as acp from "@agentclientprotocol/sdk";
import { spawn, type ChildProcess } from "node:child_process";

export interface AcpClientOptions {
  command: string;
  args: string[];
  cwd: string;
  trustAllTools: boolean;
  agentName?: string;
  modelId?: string;
}

export interface AcpSession {
  sessionId: string;
  connection: acp.ClientSideConnection;
  process: ChildProcess;
  textBuffer: string;
  options: AcpClientOptions;
}

export interface AcpPromptResult {
  output: string;
  stopReason: acp.StopReason;
  timedOut: boolean;
  error?: string;
}

export async function initAcpSession(opts: AcpClientOptions): Promise<AcpSession> {
  const child = spawn(opts.command, opts.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: opts.cwd,
    env: process.env,
  });

  if (!child.stdout || !child.stdin) {
    throw new Error("Failed to create ACP process stdio streams");
  }

  // Buffer stderr for diagnostics
  if (child.stderr) {
    child.stderr.on("data", () => {});
  }

  const session: AcpSession = {
    sessionId: "",
    connection: null as unknown as acp.ClientSideConnection,
    process: child,
    textBuffer: "",
    options: opts,
  };

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
    close() { stdin.end(); },
    abort(reason) { stdin.destroy(reason instanceof Error ? reason : new Error(String(reason))); },
  });

  let buffer = "";
  const decoder = new TextDecoder();
  let msgController: ReadableStreamDefaultController<unknown>;
  const parsedMessages = new ReadableStream<unknown>({
    start(controller) { msgController = controller; },
    cancel() { stdout.destroy(); },
  });

  stdout.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try { msgController.enqueue(JSON.parse(trimmed)); } catch { /* skip malformed */ }
      }
    }
  });
  stdout.on("end", () => {
    if (buffer.trim()) {
      try { msgController.enqueue(JSON.parse(buffer.trim())); } catch { /* skip */ }
    }
    msgController.close();
  });
  stdout.on("error", (err) => { msgController.error(err); });

  // Use ndJsonStream only for writable serialization; readable is our manual parser
  const dummyReadable = new ReadableStream<Uint8Array>({ start() {} });
  const ndJson = acp.ndJsonStream(writable, dummyReadable);
  const stream: acp.Stream = { readable: parsedMessages as ReadableStream<acp.AnyMessage>, writable: ndJson.writable };

  const client: acp.Client = {
    async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
      if (opts.trustAllTools && params.options?.length) {
        const allow = params.options.find(o => o.kind === "allow_always") ?? params.options.find(o => o.kind === "allow_once");
        if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      const { update } = params;
      if (!update) return;
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        session.textBuffer += update.content.text;
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
  const result = await session.connection.newSession({ cwd: opts.cwd, mcpServers: [] });
  session.sessionId = result.sessionId;

  // Optionally set mode/model
  if (opts.agentName) {
    await session.connection.setSessionMode({ sessionId: session.sessionId, modeId: opts.agentName });
  }
  if (opts.modelId) {
    await session.connection.unstable_setSessionModel({ sessionId: session.sessionId, modelId: opts.modelId });
  }

  return session;
}

export async function sendAcpPrompt(
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

  try {
    const response = await Promise.race([
      session.connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: prompt }],
      }),
      timeoutPromise,
    ]);
    clearTimeout(timer);
    return { output: session.textBuffer, stopReason: response.stopReason, timedOut: false };
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) {
      return { output: session.textBuffer, stopReason: "cancelled", timedOut: true };
    }
    return { output: session.textBuffer, stopReason: "end_turn", timedOut: false, error: String(err) };
  }
}

export async function terminateAcpSession(session: AcpSession): Promise<void> {
  const child = session.process;
  if (!child.pid || child.killed) return;

  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && !child.killed) {
    child.kill("SIGKILL");
  }
}
