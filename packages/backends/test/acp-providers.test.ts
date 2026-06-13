import {
  ACP_PROVIDERS,
  isAcpBackendKind,
  providerLaunchArgs,
  resolveAcpProvider,
} from "@mobrienv/autoloop-backends/acp-providers";
import { describe, expect, it } from "vitest";

describe("ACP providers", () => {
  it("treats acp and legacy kiro as ACP backend kinds", () => {
    expect(isAcpBackendKind("acp")).toBe(true);
    expect(isAcpBackendKind("kiro")).toBe(true);
    expect(isAcpBackendKind("command")).toBe(false);
    expect(isAcpBackendKind(undefined)).toBe(false);
  });

  it("normalizes legacy kiro config to the kiro ACP provider", () => {
    const provider = resolveAcpProvider({ kind: "kiro", command: "kiro-cli" });

    expect(provider.id).toBe("kiro");
    expect(provider.defaultCommand).toBe("kiro-cli");
    expect(provider.defaultArgs).toEqual(["acp"]);
    expect(provider.ignoreNotification?.("_kiro.dev/foo")).toBe(true);
  });

  it("knows the Claude Agent ACP adapter default invocation", () => {
    const provider = resolveAcpProvider({
      kind: "acp",
      provider: "claude-agent-acp",
    });

    expect(provider.defaultCommand).toBe("npx");
    expect(provider.defaultArgs).toEqual([
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]);
  });

  it("falls back to generic for unknown explicit providers", () => {
    const provider = resolveAcpProvider({
      kind: "acp",
      provider: "my-custom-agent",
    });

    expect(provider.id).toBe("generic");
    expect(provider.displayName).toBe("Generic ACP agent");
  });

  it("keeps provider ids unique", () => {
    expect(new Set(ACP_PROVIDERS.map((p) => p.id)).size).toBe(
      ACP_PROVIDERS.length,
    );
  });

  it("knows the Hermes ACP default invocation", () => {
    const provider = resolveAcpProvider({ kind: "acp", provider: "hermes" });

    expect(provider.id).toBe("hermes");
    expect(provider.defaultCommand).toBe("hermes");
    expect(provider.defaultArgs).toEqual(["acp"]);
    expect(provider.crashLabel).toBe("hermes");
    expect(provider.supportsSessionMode).toBe(true);
    expect(provider.supportsSessionModel).toBe(true);
  });

  it("auto-detects hermes by command basename", () => {
    expect(
      resolveAcpProvider({ kind: "acp", command: "/usr/local/bin/hermes" }).id,
    ).toBe("hermes");
    expect(resolveAcpProvider({ kind: "acp", command: "hermes" }).id).toBe(
      "hermes",
    );
    expect(resolveAcpProvider({ kind: "acp", command: "hermes-x" }).id).toBe(
      "generic",
    );
  });
});

describe("providerLaunchArgs", () => {
  it("prepends --profile before the acp subcommand for hermes", () => {
    expect(providerLaunchArgs("hermes", "architect", ["acp"])).toEqual([
      "--profile",
      "architect",
      "acp",
    ]);
  });

  it("returns args unchanged when no profile is set", () => {
    expect(providerLaunchArgs("hermes", "", ["acp"])).toEqual(["acp"]);
    expect(providerLaunchArgs("hermes", undefined, ["acp"])).toEqual(["acp"]);
  });

  it("ignores profile for non-hermes providers", () => {
    expect(providerLaunchArgs("kiro", "architect", ["acp"])).toEqual(["acp"]);
    expect(providerLaunchArgs("generic", "architect", [])).toEqual([]);
  });

  it("does not mutate the input args array", () => {
    const args = ["acp"];
    providerLaunchArgs("hermes", "architect", args);
    expect(args).toEqual(["acp"]);
  });
});
