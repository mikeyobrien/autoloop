import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { dispatchAcp } from "../../src/commands/acp.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

describe("dispatchAcp", () => {
  it("prints usage with --help", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.join(" "));
    });
    await dispatchAcp(["--help"], bundleRoot, "autoloop");
    vi.restoreAllMocks();
    expect(logs.join("\n")).toContain("Agent Client Protocol");
  });
});

describe("dispatchAcp end-to-end over piped streams", () => {
  it("parses flags, initializes, lists slash commands, and runs a quick command", async () => {
    const clientToAgent = new PassThrough(); // client writes -> agent reads
    const agentToClient = new PassThrough(); // agent writes -> client reads
    const projectDir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-e2e-"));

    const served = dispatchAcp(
      ["--project-dir", projectDir, "--verbose"],
      bundleRoot,
      "autoloop",
      clientToAgent,
      agentToClient,
    );

    interface JsonRpcMsg {
      id?: number;
      method?: string;
      result?: {
        stopReason?: string;
        agentInfo?: { name: string };
        sessionId?: string;
      };
      params?: {
        update?: {
          sessionUpdate?: string;
          content?: { text?: string };
          availableCommands?: Array<{ name: string }>;
        };
      };
    }
    const responses = new Map<number, (m: JsonRpcMsg) => void>();
    const notifications: JsonRpcMsg[] = [];
    let buf = "";
    agentToClient.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const msg = JSON.parse(t) as JsonRpcMsg;
        if (msg.id !== undefined && responses.has(msg.id)) {
          responses.get(msg.id)?.(msg);
          responses.delete(msg.id);
        } else if (msg.method) {
          notifications.push(msg);
        }
      }
    });

    let id = 0;
    const call = (method: string, params: unknown) =>
      new Promise<JsonRpcMsg>((res) => {
        const reqId = ++id;
        responses.set(reqId, res);
        clientToAgent.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params })}\n`,
        );
      });

    const init = await call("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    expect(init.result.agentInfo.name).toBe("autoloop");

    const sess = await call("session/new", {
      cwd: projectDir,
      mcpServers: [],
    });
    const sessionId = sess.result.sessionId;
    expect(sessionId).toMatch(/^autoloop-/);

    const cmdsNote = notifications.find(
      (n) => n.params?.update?.sessionUpdate === "available_commands_update",
    );
    expect(cmdsNote.params.update.availableCommands[0].name).toBe("run");

    notifications.length = 0;
    const listRes = await call("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "list" }],
    });
    expect(listRes.result.stopReason).toBe("end_turn");
    const text = notifications
      .filter((n) => n.params?.update?.sessionUpdate === "agent_message_chunk")
      .map((n) => n.params.update.content.text)
      .join("");
    expect(text).toContain("autocode");

    // Close the client side; serveAcp should resolve.
    clientToAgent.end();
    agentToClient.end();
    await served;
  });
});
