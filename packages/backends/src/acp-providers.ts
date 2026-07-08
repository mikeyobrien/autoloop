export type AcpProviderId = "generic" | "kiro" | "claude-agent-acp" | "hermes";

export interface AcpProvider {
  id: AcpProviderId;
  displayName: string;
  defaultCommand: string;
  defaultArgs: string[];
  defaultPromptMode: "acp";
  crashLabel: string;
  interruptDetail: string;
  supportsSessionMode: boolean;
  supportsSessionModel: boolean;
  ignoreNotification?: (method: string) => boolean;
}

export interface ResolveAcpProviderInput {
  kind?: string;
  provider?: string;
  command?: string;
}

export const ACP_PROVIDERS: AcpProvider[] = [
  {
    id: "generic",
    displayName: "Generic ACP agent",
    defaultCommand: "",
    defaultArgs: [],
    defaultPromptMode: "acp",
    crashLabel: "ACP agent",
    interruptDetail: "ACP cancel + child-process-group SIGTERM",
    supportsSessionMode: true,
    supportsSessionModel: true,
  },
  {
    id: "kiro",
    displayName: "Kiro ACP",
    defaultCommand: "kiro-cli",
    defaultArgs: ["acp"],
    defaultPromptMode: "acp",
    crashLabel: "kiro-cli",
    interruptDetail: "ACP cancel + child-process-group SIGTERM",
    supportsSessionMode: true,
    supportsSessionModel: true,
    ignoreNotification: (method) => method.startsWith("_kiro.dev/"),
  },
  {
    id: "claude-agent-acp",
    displayName: "Claude Agent ACP",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@agentclientprotocol/claude-agent-acp"],
    defaultPromptMode: "acp",
    crashLabel: "claude-agent-acp",
    interruptDetail: "ACP cancel + child-process-group SIGTERM",
    supportsSessionMode: true,
    supportsSessionModel: true,
  },
  {
    id: "hermes",
    displayName: "Hermes ACP",
    defaultCommand: "hermes",
    defaultArgs: ["acp"],
    defaultPromptMode: "acp",
    crashLabel: "hermes",
    interruptDetail: "ACP cancel + child-process-group SIGTERM",
    supportsSessionMode: true,
    supportsSessionModel: true,
  },
];

export function isAcpBackendKind(kind: string | undefined): boolean {
  return kind === "acp" || kind === "kiro" || kind === "hermes";
}

export function resolveAcpProvider(
  input: ResolveAcpProviderInput,
): AcpProvider {
  const explicit = input.provider?.trim();
  if (explicit) return providerById(explicit) ?? providerById("generic");
  if (input.kind === "kiro") return providerById("kiro");
  if (input.kind === "hermes") return providerById("hermes");
  if (basename(input.command ?? "") === "kiro-cli") return providerById("kiro");
  if (basename(input.command ?? "") === "hermes") return providerById("hermes");
  return providerById("generic");
}

/**
 * Final launch argv for an ACP provider process. Hermes selects its agent
 * profile via a top-level `--profile <name>` flag that must precede the
 * `acp` subcommand; other providers have no profile concept.
 */
export function providerLaunchArgs(
  provider: string,
  profile: string | undefined,
  args: string[],
): string[] {
  if (provider === "hermes" && profile) {
    return ["--profile", profile, ...args];
  }
  return [...args];
}

function providerById(id: string): AcpProvider {
  return ACP_PROVIDERS.find((p) => p.id === id) ?? ACP_PROVIDERS[0];
}

function basename(command: string): string {
  return command.split(/[\\/]/).pop() ?? command;
}
