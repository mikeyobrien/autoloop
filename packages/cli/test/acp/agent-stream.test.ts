import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const bundleRoot = resolve(import.meta.dirname, "../..");

// Mock the run executor so the agent's stream path resolves deterministically
// without launching a real loop.
const executeRunMock = vi.fn();
vi.mock("../../src/acp/run-exec.js", () => ({
  executeRun: (...args: unknown[]) => executeRunMock(...args),
}));

const runQuickMock = vi.fn();
vi.mock("../../src/acp/quick.js", () => ({
  runQuickCommand: (...args: unknown[]) => runQuickMock(...args),
}));

const { AutoloopAgent } = await import("../../src/acp/agent.js");

interface Recorded {
  updates: acp.SessionNotification[];
}

function makeAgent(): {
  agent: InstanceType<typeof AutoloopAgent>;
  rec: Recorded;
} {
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
  const projectDir = mkdtempSync(resolve(tmpdir(), "autoloop-acp-stream-"));
  const agent = new AutoloopAgent(conn, {
    bundleRoot,
    selfCmd: "autoloop",
    projectDir,
  });
  return { agent, rec };
}

afterEach(() => {
  executeRunMock.mockReset();
  runQuickMock.mockReset();
});

function textOf(rec: Recorded): string {
  return rec.updates
    .map((n) =>
      n.update.sessionUpdate === "agent_message_chunk" &&
      n.update.content.type === "text"
        ? n.update.content.text
        : "",
    )
    .join("");
}

describe("AutoloopAgent quick path (mocked)", () => {
  it("returns captured text from a quick command", async () => {
    runQuickMock.mockResolvedValue({
      stdout: "rows here",
      stderr: "",
      exitCode: 0,
    });
    const { agent, rec } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "loops" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("end_turn");
    expect(textOf(rec)).toContain("rows here");
  });

  it("threads the session cwd via AUTOLOOP_PROJECT_DIR and restores it", async () => {
    const sessionCwd = mkdtempSync(resolve(tmpdir(), "autoloop-acp-cwd-"));
    let seenEnv: string | undefined;
    let seenCtxDir: string | undefined;
    runQuickMock.mockImplementation(
      async (_name: string, _args: string[], ctx: { projectDir: string }) => {
        seenEnv = process.env.AUTOLOOP_PROJECT_DIR;
        seenCtxDir = ctx.projectDir;
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    );
    const prior = process.env.AUTOLOOP_PROJECT_DIR;
    const { agent } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: sessionCwd,
      mcpServers: [],
    } as acp.NewSessionRequest);
    await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "loops" }],
    } as acp.PromptRequest);
    expect(seenEnv).toBe(sessionCwd);
    expect(seenCtxDir).toBe(sessionCwd);
    // Restored to whatever it was before the turn.
    expect(process.env.AUTOLOOP_PROJECT_DIR).toBe(prior);
  });

  it("reports a placeholder when a quick command produces no output", async () => {
    runQuickMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const { agent, rec } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "loops" }],
    } as acp.PromptRequest);
    expect(textOf(rec)).toContain("produced no output");
  });

  it("returns a refusal when a quick command throws", async () => {
    runQuickMock.mockRejectedValue(new Error("disk full"));
    const { agent, rec } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "loops" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("refusal");
    expect(textOf(rec)).toContain("Error running loops: disk full");
  });
});

describe("AutoloopAgent stream path", () => {
  it("dispatches a run prompt through executeRun and returns its stop reason", async () => {
    let seenProjectDir: string | undefined;
    executeRunMock.mockImplementation(
      async (verb: string, args: string[], ctx: { projectDir: string }) => {
        expect(verb).toBe("run");
        expect(args).toEqual(["autocode", "Fix bug"]);
        seenProjectDir = ctx.projectDir;
        return {
          stopReason: "end_turn",
          summary: "Loop completed after 2 iterations",
        };
      },
    );
    const sessionCwd = mkdtempSync(resolve(tmpdir(), "autoloop-acp-run-cwd-"));
    const { agent, rec } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: sessionCwd,
      mcpServers: [],
    } as acp.NewSessionRequest);

    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: 'run autocode "Fix bug"' }],
    } as acp.PromptRequest);

    expect(res.stopReason).toBe("end_turn");
    expect(seenProjectDir).toBe(sessionCwd);
    const text = rec.updates
      .filter((n) => n.update.sessionUpdate === "agent_message_chunk")
      .map((n) =>
        n.update.sessionUpdate === "agent_message_chunk" &&
        n.update.content.type === "text"
          ? n.update.content.text
          : "",
      )
      .join("");
    expect(text).toContain("Loop completed");
  });

  it("cancel aborts the active turn's signal", async () => {
    let captured: AbortSignal | undefined;
    executeRunMock.mockImplementation(
      (_v: string, _a: string[], ctx: { signal: AbortSignal }) =>
        new Promise((res) => {
          captured = ctx.signal;
          ctx.signal.addEventListener("abort", () =>
            res({ stopReason: "cancelled", summary: "cancelled" }),
          );
        }),
    );
    const { agent } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "run autocode" }],
    } as acp.PromptRequest);

    // Allow the prompt handler to register the active turn.
    await new Promise((r) => setTimeout(r, 5));
    await agent.cancel({ sessionId } as acp.CancelNotification);

    const res = await promptPromise;
    expect(captured?.aborted).toBe(true);
    expect(res.stopReason).toBe("cancelled");
  });

  it("reports a refusal when executeRun throws", async () => {
    executeRunMock.mockRejectedValue(new Error("kaboom"));
    const { agent, rec } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "run autocode" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("refusal");
    const text = rec.updates
      .map((n) =>
        n.update.sessionUpdate === "agent_message_chunk" &&
        n.update.content.type === "text"
          ? n.update.content.text
          : "",
      )
      .join("");
    expect(text).toContain("Run error: kaboom");
  });

  it("treats a bare objective as a default-preset run", async () => {
    let seenVerb: string | undefined;
    let seenArgs: string[] | undefined;
    executeRunMock.mockImplementation(async (verb: string, args: string[]) => {
      seenVerb = verb;
      seenArgs = args;
      return { stopReason: "end_turn", summary: "ok" };
    });
    const { agent } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    const res = await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "build the login page" }],
    } as acp.PromptRequest);
    expect(res.stopReason).toBe("end_turn");
    expect(seenVerb).toBe("run");
    expect(seenArgs).toEqual(["autocode", "build the login page"]);
  });

  it("strips a <user_message> wrapper before dispatching", async () => {
    let seenArgs: string[] | undefined;
    executeRunMock.mockImplementation(async (_verb: string, args: string[]) => {
      seenArgs = args;
      return { stopReason: "end_turn", summary: "ok" };
    });
    const { agent } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    await agent.prompt({
      sessionId,
      prompt: [
        { type: "text", text: "<user_message>ship the feature</user_message>" },
      ],
    } as acp.PromptRequest);
    expect(seenArgs).toEqual(["autocode", "ship the feature"]);
  });

  it("strips a wrapper around an explicit command", async () => {
    let seenVerb: string | undefined;
    let seenArgs: string[] | undefined;
    executeRunMock.mockImplementation(async (verb: string, args: string[]) => {
      seenVerb = verb;
      seenArgs = args;
      return { stopReason: "end_turn", summary: "ok" };
    });
    const { agent } = makeAgent();
    const { sessionId } = await agent.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    } as acp.NewSessionRequest);
    await agent.prompt({
      sessionId,
      prompt: [
        {
          type: "text",
          text: '<user_message>run autoqa "exercise onboarding"</user_message>',
        },
      ],
    } as acp.PromptRequest);
    expect(seenVerb).toBe("run");
    expect(seenArgs).toEqual(["autoqa", "exercise onboarding"]);
  });
});
