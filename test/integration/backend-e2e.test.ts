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

const hasPython3 =
  spawnSync("python3", ["--version"], { encoding: "utf-8" }).status === 0;

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
  // Fake pi binary: verifies the built-in pi flags arrive, reads the prompt
  // on stdin, and answers with pi --mode json event lines.
  const FAKE_PI = `
const args = process.argv.slice(2);
for (const flag of ["-p", "--mode", "json", "--no-session"]) {
  if (!args.includes(flag)) {
    process.stderr.write("fake-pi: missing expected flag " + flag + "\\n");
    process.exit(9);
  }
}
let prompt = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  if (!prompt.trim()) {
    process.stderr.write("fake-pi: empty prompt on stdin\\n");
    process.exit(8);
  }
  const text = "pi backend handled the iteration. LOOP_COMPLETE";
  const events = [
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } },
    { type: "turn_end", message: { content: [{ type: "text", text }] } },
  ];
  for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
});
`;

  it.skipIf(!hasPython3)(
    "completes a loop through the pi adapter bridge",
    () => {
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
    },
    30_000,
  );
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

  it("injects headless flags via -b and completes a loop", () => {
    const bin = mkdtempSync(join(tmpdir(), "autoloop-fake-claude-"));
    const fakeClaudeScript = writeExecutable(
      bin,
      "fake-claude.cjs",
      FAKE_CLAUDE,
    );
    const claudePath = wrapNodeScript(bin, "claude", fakeClaudeScript);

    const project = makeBackendProject("claude", [
      'backend.kind = "command"',
      'backend.command = "echo"',
      "backend.timeout_ms = 30000",
    ]);
    const res = runCli(["run", project, "claude e2e", "-b", claudePath], {});

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
