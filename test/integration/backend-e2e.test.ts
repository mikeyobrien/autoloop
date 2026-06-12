import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureBuild,
  MOCK_ACP_SERVER,
  PRESET_FIXTURE_DIR,
  ROOT,
  readText,
  runCli,
} from "../helpers/runtime.js";

beforeAll(() => {
  ensureBuild();
});

/**
 * End-to-end coverage for every backend harness supported out of the box:
 * pi (via the pi-adapter bridge), claude (command backend with flag
 * injection), and the ACP providers (kiro, claude-agent-acp, generic).
 * The plain command backend is exercised end-to-end by run-loop.test.ts.
 *
 * Each test drives the real built CLI against a fake provider executable
 * and asserts the loop completes through the journal artifacts.
 */

/**
 * The pi adapter re-invokes the CLI via its own executable path (selfCommand
 * uses argv[1]), so the pi test must go through the real bin entry point
 * rather than `node dist/main.js`.
 */
function runBinCli(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number | null } {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AUTOLOOP_")) delete env[key];
  }
  const res = spawnSync(join(ROOT, "bin/autoloop"), args, {
    cwd,
    encoding: "utf-8",
    timeout: 60_000,
    env,
  });
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    status: res.status,
  };
}

function makeBackendProject(name: string, backendToml: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), `autoloop-e2e-${name}-`));
  cpSync(PRESET_FIXTURE_DIR, dir, { recursive: true });
  const configPath = join(dir, "autoloops.toml");
  const config = readFileSync(configPath, "utf-8")
    .split("\n")
    .filter((line) => !line.startsWith("backend."))
    .join("\n");
  writeFileSync(configPath, `${config}\n${backendToml.join("\n")}\n`, "utf-8");
  return dir;
}

function writeExecutable(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  chmodSync(path, 0o755);
  return path;
}

/** Shell wrapper so a node script can be addressed as a single executable. */
function wrapNodeScript(dir: string, name: string, script: string): string {
  return writeExecutable(
    dir,
    name,
    `#!/bin/sh\nexec node ${JSON.stringify(script)} "$@"\n`,
  );
}

function expectLoopCompleted(project: string): string {
  const journal = readText(join(project, ".autoloop/journal.jsonl"));
  expect(journal).toContain('"topic": "loop.complete"');
  expect(journal).toContain('"reason": "completion_promise"');
  return journal;
}

describe("integration: pi backend end to end", () => {
  // Fake pi binary: verifies the harness launches RPC mode, then speaks the
  // pi --mode rpc JSONL protocol (responses for commands, streamed events).
  const FAKE_PI = `
const args = process.argv.slice(2);
for (const flag of ["--mode", "rpc", "--no-session"]) {
  if (!args.includes(flag)) {
    process.stderr.write("fake-pi: missing expected flag " + flag + "\\n");
    process.exit(9);
  }
}
const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");
let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx = buffer.indexOf("\\n");
  while (idx !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    idx = buffer.indexOf("\\n");
    if (!line.trim()) continue;
    const cmd = JSON.parse(line);
    if (cmd.type === "prompt") {
      if (!cmd.message || !cmd.message.trim()) {
        process.stderr.write("fake-pi: empty prompt message\\n");
        process.exit(8);
      }
      out({ type: "response", id: cmd.id, command: "prompt", success: true });
      const text = "pi backend handled the iteration. LOOP_COMPLETE";
      out({ type: "agent_start" });
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
      out({
        type: "agent_end",
        messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] }],
      });
    } else if (cmd.type === "get_session_stats") {
      out({
        type: "response", id: cmd.id, command: cmd.type, success: true,
        data: {
          tokens: { input: 120, output: 45, cacheRead: 10, cacheWrite: 3, total: 178 },
          cost: 0.07,
          contextUsage: { percent: 12 },
        },
      });
    } else {
      out({ type: "response", id: cmd.id, command: cmd.type, success: true });
    }
  }
});
`;

  it("completes a loop through a live pi RPC session", () => {
    const bin = mkdtempSync(join(tmpdir(), "autoloop-fake-pi-"));
    const fakePiScript = writeExecutable(bin, "fake-pi.cjs", FAKE_PI);
    const piPath = wrapNodeScript(bin, "pi", fakePiScript);

    const project = makeBackendProject("pi", [
      'backend.kind = "pi"',
      `backend.command = ${JSON.stringify(piPath)}`,
      "backend.timeout_ms = 30000",
    ]);
    const res = runBinCli(["run", project, "pi e2e"], project);

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain("pi backend handled the iteration.");

    // Usage telemetry journaled from pi's get_session_stats
    expect(journal).toContain('"topic": "backend.usage"');
    expect(journal).toContain('"total_tokens": 178');
    expect(journal).toContain('"cost_usd": 0.07');

    // Raw RPC stream persisted per iteration in the run-scoped state dir
    const runId = journal.match(/"run": "([^"]+)"/)?.[1] ?? "";
    const streamLog = readText(
      join(project, ".autoloop/runs", runId, "pi-stream.1.jsonl"),
    );
    expect(streamLog).toContain('"type":"agent_end"');
  }, 30_000);
});

describe("integration: claude command backend end to end", () => {
  // Fake claude binary: fails unless the harness injected the headless
  // flags, then completes via the loop promise.
  const FAKE_CLAUDE = `
const args = process.argv.slice(2);
if (!args.includes("-p") || !args.includes("--dangerously-skip-permissions")) {
  process.stderr.write("fake-claude: headless flags were not injected\\n");
  process.exit(9);
}
process.stdout.write("claude backend handled the iteration. LOOP_COMPLETE\\n");
`;

  // The shell path is opt-in now that plain `claude` defaults to the
  // claude-sdk backend: pin kind = "command" to exercise flag injection.
  it("injects headless flags on the explicit command kind and completes a loop", () => {
    const bin = mkdtempSync(join(tmpdir(), "autoloop-fake-claude-"));
    const fakeClaudeScript = writeExecutable(
      bin,
      "fake-claude.cjs",
      FAKE_CLAUDE,
    );
    const claudePath = wrapNodeScript(bin, "claude", fakeClaudeScript);

    const project = makeBackendProject("claude", [
      'backend.kind = "command"',
      `backend.command = "${claudePath}"`,
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(["run", project, "claude e2e"], {});

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain("claude backend handled the iteration.");
  }, 30_000);
});

describe("integration: ACP backend providers end to end", () => {
  it("kiro provider applies agent/model, trusts tools, and filters kiro noise", () => {
    const project = makeBackendProject("acp-kiro", [
      'backend.kind = "acp"',
      'backend.provider = "kiro"',
      'backend.command = "node"',
      `backend.args = [${JSON.stringify(MOCK_ACP_SERVER)}]`,
      'backend.agent = "reviewer"',
      'backend.model = "test-model"',
      "backend.trust_all_tools = true",
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(["run", project, "kiro acp e2e"], {
      MOCK_ACP_KIRO_NOISE: "1",
    });

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain(
      "mock-acp mode=reviewer model=test-model permission=selected:allow",
    );
  }, 30_000);

  it("claude-agent-acp provider completes a loop without agent/model overrides", () => {
    const project = makeBackendProject("acp-claude", [
      'backend.kind = "acp"',
      'backend.provider = "claude-agent-acp"',
      'backend.command = "node"',
      `backend.args = [${JSON.stringify(MOCK_ACP_SERVER)}]`,
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(["run", project, "claude agent acp e2e"], {});

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain("mock-acp mode=none model=none");
  }, 30_000);

  it('legacy kind = "kiro" config still runs through the ACP path', () => {
    const project = makeBackendProject("acp-legacy-kiro", [
      'backend.kind = "kiro"',
      'backend.command = "node"',
      `backend.args = [${JSON.stringify(MOCK_ACP_SERVER)}]`,
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(["run", project, "legacy kiro e2e"], {});

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain("mock-acp mode=none model=none");
  }, 30_000);

  it("generic provider runs via the -b acp:<provider>:<command> alias", () => {
    const bin = mkdtempSync(join(tmpdir(), "autoloop-acp-generic-"));
    const serverPath = wrapNodeScript(bin, "mock-acp", MOCK_ACP_SERVER);

    const project = makeBackendProject("acp-generic", [
      'backend.kind = "command"',
      'backend.command = "echo"',
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(
      ["run", project, "generic acp e2e", "-b", `acp:custom:${serverPath}`],
      {},
    );

    expect(res.status).toBe(0);
    const journal = expectLoopCompleted(project);
    expect(journal).toContain("mock-acp mode=none model=none");
  }, 30_000);
});
