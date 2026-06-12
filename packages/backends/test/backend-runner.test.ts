import {
  buildBackendShellCommand,
  normalizeProviderKind,
  runAcpIteration,
  runKiroIteration,
} from "@mobrienv/autoloop-backends";
import { runShellCommand } from "@mobrienv/autoloop-backends/run-command";
import { describe, expect, it } from "vitest";

describe("backend runner", () => {
  it("exports runAcpIteration as the canonical ACP runner with the Kiro alias preserved", () => {
    expect(runAcpIteration).toBeTypeOf("function");
    expect(runKiroIteration).toBe(runAcpIteration);
  });

  it("normalizes ACP provider kind with provider label", () => {
    expect(
      normalizeProviderKind({
        kind: "acp",
        provider: "claude-agent-acp",
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      }),
    ).toBe("acp:claude-agent-acp");
  });

  it("normalizes mock provider kind", () => {
    expect(
      normalizeProviderKind({
        kind: "command",
        command: "node",
        args: ["dist/testing/mock-backend.js"],
      }),
    ).toBe("mock");
  });

  it("builds command backend shell invocation", () => {
    const command = buildBackendShellCommand({
      paths: { stateDir: "/tmp/state", piAdapterPath: "/tmp/pi-adapter" },
      spec: { kind: "command", command: "echo", args: [], promptMode: "arg" },
      prompt: "hello",
      runtimeEnv: "export X=1\n",
    });
    expect(command).toContain("export AUTOLOOP_PROMPT_PATH=");
    expect(command).toContain("'echo' 'hello'");
  });

  it("injects headless claude flags for claude-sdk specs in shell fallback", () => {
    const command = buildBackendShellCommand({
      paths: { stateDir: "/tmp/state", piAdapterPath: "/tmp/pi-adapter" },
      spec: {
        kind: "claude-sdk",
        command: "claude",
        args: [],
        promptMode: "arg",
      },
      prompt: "wave task",
      runtimeEnv: "",
    });
    expect(command).toContain(
      "'claude' '-p' '--dangerously-skip-permissions' 'wave task'",
    );
  });

  it("does not duplicate headless flags already present on claude-sdk specs", () => {
    const command = buildBackendShellCommand({
      paths: { stateDir: "/tmp/state", piAdapterPath: "/tmp/pi-adapter" },
      spec: {
        kind: "claude-sdk",
        command: "claude",
        args: ["-p", "--dangerously-skip-permissions"],
        promptMode: "arg",
      },
      prompt: "wave task",
      runtimeEnv: "",
    });
    expect(command.match(/--dangerously-skip-permissions/g)?.length).toBe(1);
  });

  it("reports non-zero exit failures", () => {
    const result = runShellCommand(
      "command",
      "sh -c 'echo nope; exit 3'",
      5000,
    );
    expect(result.exitCode).toBe(3);
    expect(result.errorCategory).toBe("non_zero_exit");
  });

  it("classifies exec timeouts as timeout errors", () => {
    const result = runShellCommand(
      "command",
      'node -e "setTimeout(() => {}, 1000)"',
      10,
    );
    expect(result.timedOut).toBe(true);
    expect(result.errorCategory).toBe("timeout");
  });
});
