import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { AutoloopAgent } from "../../src/acp/agent.js";

const bundleRoot = resolve(import.meta.dirname, "../..");

interface Recorded {
  updates: acp.SessionNotification[];
}

function makeConn(): { conn: acp.AgentSideConnection; rec: Recorded } {
  const rec: Recorded = { updates: [] };
  const ac = new AbortController();
  const conn = {
    sessionUpdate: async (n: acp.SessionNotification) => {
      rec.updates.push(n);
    },
    get signal() {
      return ac.signal;
    },
    closed: Promise.resolve(),
  } as unknown as acp.AgentSideConnection;
  return { conn, rec };
}

function makeAgent(): { agent: AutoloopAgent; rec: Recorded } {
  const { conn, rec } = makeConn();
  const projectDir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-agent-"));
  const agent = new AutoloopAgent(conn, {
    bundleRoot,
    selfCmd: "autoloop",
    projectDir,
  });
  return { agent, rec };
}

function textOf(rec: Recorded): string {
  return rec.updates
    .filter((n) => n.update.sessionUpdate === "agent_message_chunk")
    .map((n) =>
      n.update.sessionUpdate === "agent_message_chunk" &&
      n.update.content.type === "text"
        ? n.update.content.text
        : "",
    )
    .join("\n");
}

describe("AutoloopAgent", () => {
  let agent: AutoloopAgent;
  afterEach(async () => {
    await agent?.shutdown();
  });

  it("initialize advertises agent info and clamps protocol version", async () => {
    ({ agent } = makeAgent());
    const res = await agent.initialize({
      protocolVersion: 999,
      clientCapabilities: {},
    } as acp.InitializeRequest);
    expect(res.agentInfo?.name).toBe("autoloop");
    expect(res.protocolVersion).toBeLessThanOrEqual(999);
  });

  it("newSession advertises slash commands with run first", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const res = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    expect(res.sessionId).toMatch(/^autoloop-/);
    const update = rec.updates[0].update;
    expect(update.sessionUpdate).toBe("available_commands_update");
    if (update.sessionUpdate === "available_commands_update") {
      expect(update.availableCommands[0].name).toBe("run");
    }
  });

  it("newSession rejects when cwd is omitted", async () => {
    ({ agent } = makeAgent());
    await expect(
      agent.newSession({
        mcpServers: [],
      } as acp.NewSessionRequest),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("newSession rejects when cwd is blank", async () => {
    ({ agent } = makeAgent());
    await expect(
      agent.newSession({
        cwd: "   ",
        mcpServers: [],
      } as acp.NewSessionRequest),
    ).rejects.toThrow(/cwd/);
  });

  it("refuses prompts for unknown sessions", async () => {
    ({ agent } = makeAgent());
    const res = await agent.prompt({
      sessionId: "missing",
      prompt: [{ type: "text", text: "list" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("refusal");
  });

  it("returns help for an empty prompt", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    rec.updates.length = 0;
    await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "   " }],
    } as acp.PromptRequest);
    expect(textOf(rec)).toContain("Enter a command");
  });

  it("runs a quick command (list) and returns captured text", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    rec.updates.length = 0;
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "list" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("end_turn");
    expect(textOf(rec)).toContain("autocode");
  });

  it("starts and stops the dashboard, surfacing the URL", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);

    rec.updates.length = 0;
    const startRes = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "dashboard start --port 0" }],
    } as acp.PromptRequest);
    expect(startRes.stopReason).toBe("end_turn");
    expect(textOf(rec)).toMatch(/http:\/\/127\.0\.0\.1:\d+/);

    rec.updates.length = 0;
    const stopRes = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "dashboard stop" }],
    } as acp.PromptRequest);
    expect(stopRes.stopReason).toBe("end_turn");
    expect(textOf(rec)).toContain("stopped");
  });

  it("cancel on an idle session is a no-op", async () => {
    ({ agent } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    await expect(
      agent.cancel({ sessionId } as acp.CancelNotification),
    ).resolves.toBeUndefined();
  });

  it("authenticate acknowledges with an empty response", async () => {
    ({ agent } = makeAgent());
    await expect(
      agent.authenticate({} as acp.AuthenticateRequest),
    ).resolves.toEqual({});
  });

  it("reports a refusal when the dashboard port is already in use", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);

    // Occupy a port with a throwaway server, then ask the dashboard to bind it.
    const net = await import("node:net");
    const blocker = net.createServer();
    await new Promise<void>((res) =>
      blocker.listen(0, "127.0.0.1", () => res()),
    );
    const busyPort = (blocker.address() as { port: number }).port;
    try {
      rec.updates.length = 0;
      const res = await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: `dashboard start --port ${busyPort}` }],
      } as acp.PromptRequest);
      expect(res.stopReason).toBe("refusal");
      expect(textOf(rec)).toContain("Failed to start dashboard");
    } finally {
      await new Promise<void>((res) => blocker.close(() => res()));
    }
  });

  it("shutdown aborts active turns and stops the dashboard", async () => {
    let rec: Recorded;
    ({ agent, rec } = makeAgent());
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "dashboard start --port 0" }],
    } as acp.PromptRequest);
    await agent.shutdown();
    rec.updates.length = 0;
    // After shutdown the dashboard singleton is stopped; status reports none.
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "dashboard status" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("end_turn");
    expect(textOf(rec)).toContain("No dashboard");
  });
});
