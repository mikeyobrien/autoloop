import {
  buildBackendShellCommand,
  normalizeProviderKind,
} from "@mobrienv/autoloop-harness/backend";
import { runShellCommand } from "@mobrienv/autoloop-harness/backend/run-command";
import { describe, expect, it } from "vitest";

describe("backend runner", () => {
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
      loop: {
        paths: { stateDir: "/tmp/state", piAdapterPath: "/tmp/pi-adapter" },
      } as any,
      spec: { kind: "command", command: "echo", args: [], promptMode: "arg" },
      prompt: "hello",
      runtimeEnv: "export X=1\n",
    });
    expect(command).toContain("export AUTOLOOP_PROMPT_PATH=");
    expect(command).toContain("'echo' 'hello'");
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
