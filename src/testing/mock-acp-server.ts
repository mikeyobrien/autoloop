#!/usr/bin/env node

/**
 * Deterministic mock ACP stdio server for autoloop integration tests.
 *
 * Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, implementing the
 * minimal agent surface the autoloop ACP client exercises:
 *
 *   initialize          → echoes the requested protocol version
 *   session/new         → returns a fixed session id
 *   session/set_mode    → records the mode id
 *   session/set_model   → records the model id
 *   session/prompt      → requests tool permission from the client, streams an
 *                         agent_message_chunk that reports the recorded
 *                         mode/model/permission outcome, then ends the turn
 *
 * Environment knobs:
 *   MOCK_ACP_RESPONSE    extra response text (defaults to "LOOP_COMPLETE")
 *   MOCK_ACP_KIRO_NOISE  when "1", emits a provider-private `_kiro.dev/...`
 *                        notification that ACP clients must filter out
 */

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

let modeId = "none";
let modelId = "none";
let nextOutboundId = 1000;
const pendingOutbound = new Map<number | string, (result: unknown) => void>();

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function respond(id: number | string, result: unknown): void {
  send({ id, result });
}

function notify(method: string, params: Record<string, unknown>): void {
  send({ method, params });
}

function request(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const id = nextOutboundId++;
  return new Promise((resolve) => {
    pendingOutbound.set(id, resolve);
    send({ id, method, params });
  });
}

async function handlePrompt(msg: JsonRpcMessage): Promise<void> {
  const params = msg.params as { sessionId: string };

  const permission = (await request("session/request_permission", {
    sessionId: params.sessionId,
    toolCall: {
      toolCallId: "mock-tool-1",
      title: "mock tool",
      kind: "execute",
      status: "pending",
    },
    options: [
      { optionId: "allow", name: "Allow always", kind: "allow_always" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
  })) as { outcome?: { outcome?: string; optionId?: string } };

  const outcome = permission?.outcome?.outcome ?? "none";
  const optionId = permission?.outcome?.optionId ?? "none";

  if (process.env.MOCK_ACP_KIRO_NOISE === "1") {
    notify("_kiro.dev/heartbeat", { noise: true });
  }

  const extra = process.env.MOCK_ACP_RESPONSE ?? "LOOP_COMPLETE";
  const text = `mock-acp mode=${modeId} model=${modelId} permission=${outcome}:${optionId}\n${extra}`;

  notify("session/update", {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });

  if (msg.id !== undefined) respond(msg.id, { stopReason: "end_turn" });
}

function handleMessage(msg: JsonRpcMessage): void {
  // Response to one of our outbound requests (permission flow)
  if (msg.id !== undefined && msg.method === undefined) {
    const resolve = pendingOutbound.get(msg.id);
    if (resolve) {
      pendingOutbound.delete(msg.id);
      resolve(msg.result);
    }
    return;
  }

  switch (msg.method) {
    case "initialize": {
      const params = msg.params as { protocolVersion?: unknown };
      if (msg.id !== undefined)
        respond(msg.id, {
          protocolVersion: params?.protocolVersion ?? 1,
          agentCapabilities: {},
        });
      return;
    }
    case "session/new":
      if (msg.id !== undefined)
        respond(msg.id, { sessionId: "mock-acp-session" });
      return;
    case "session/set_mode": {
      modeId = String((msg.params as { modeId?: unknown })?.modeId ?? "none");
      if (msg.id !== undefined) respond(msg.id, {});
      return;
    }
    case "session/set_model": {
      modelId = String(
        (msg.params as { modelId?: unknown })?.modelId ?? "none",
      );
      if (msg.id !== undefined) respond(msg.id, {});
      return;
    }
    case "session/prompt":
      void handlePrompt(msg);
      return;
    default:
      // Unknown request → empty result; notifications (e.g. session/cancel) ignored
      if (msg.id !== undefined) respond(msg.id, {});
      return;
  }
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleMessage(JSON.parse(trimmed) as JsonRpcMessage);
    } catch {
      /* skip malformed input */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
