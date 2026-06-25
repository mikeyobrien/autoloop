import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { lineSep, listContains, listText } from "./utils.js";

export interface Role {
  id: string;
  prompt: string;
  promptFile: string;
  emits: string[];
  backendKind?: string;
  backendProvider?: string;
  backendCommand?: string;
  backendArgs?: string[];
  backendPromptMode?: string;
  backendTimeoutMs?: number;
  backendAgent?: string;
  backendModel?: string;
}

/**
 * An evidence gate (opt-in). When an agent emits `event`, its payload must
 * carry every key in `requires` (as `key=value` / `key: value` tokens or a JSON
 * object, with a non-empty value). If any are missing, the emit is rejected and
 * the typed `blocked` event is journaled instead — preserving an evidence-bearing
 * quality gate over a topology that otherwise only checks allowed-event routing.
 *
 * Declared in topology.toml as array-of-tables (parsed raw, so the structure
 * survives — unlike the stringified autoloops.toml config layer):
 *
 *   [[gate]]
 *   event = "verify.passed"
 *   requires = ["tests", "coverage"]
 *   blocked = "verify.blocked"   # optional; defaults to <prefix>.blocked
 */
export interface Gate {
  event: string;
  requires: string[];
  blocked: string;
}

export interface Topology {
  name: string;
  completion: string;
  roles: Role[];
  handoff: Record<string, string[]>;
  handoffKeys: string[];
  gates: Gate[];
}

/**
 * Default typed-blocked topic for a gated event: replace the last dotted segment
 * with `blocked` (`verify.passed` -> `verify.blocked`, `build.done` ->
 * `build.blocked`); a single-segment event gets `.blocked` appended.
 */
export function deriveBlockedTopic(event: string): string {
  const dot = event.lastIndexOf(".");
  if (dot <= 0) return `${event}.blocked`;
  return `${event.slice(0, dot)}.blocked`;
}

/** The gate configured for `topic`, if any. */
export function gateForEvent(
  topology: Topology,
  topic: string,
): Gate | undefined {
  return topology.gates.find((g) => g.event === topic);
}

export function eventMatchesAny(topic: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (eventMatchesPattern(topic, pattern)) return true;
  }
  return false;
}

export function getRoleIds(topology: Topology): string[] {
  return topology.roles.map((r) => r.id);
}

export function allEmittedEvents(topology: Topology): string[] {
  const all: string[] = [];
  for (const role of topology.roles) {
    for (const e of role.emits) {
      if (!all.includes(e)) all.push(e);
    }
  }
  return all;
}

export function handoffKeys(topology: Topology): string[] {
  return topology.handoffKeys;
}

export function handoffTargetIds(topology: Topology): string[] {
  const all: string[] = [];
  for (const key of topology.handoffKeys) {
    for (const target of topology.handoff[key] ?? []) {
      if (!all.includes(target)) all.push(target);
    }
  }
  return all;
}

export function loadTopology(projectDir: string): Topology {
  const path = join(projectDir, "topology.toml");
  if (!existsSync(path)) return defaultTopology();
  return loadExisting(path, projectDir);
}

export function completionEvent(topology: Topology, fallback: string): string {
  return topology.completion || fallback;
}

export function suggestedRoles(
  topology: Topology,
  recentEvent: string,
): string[] {
  const roles = collectMatchingRoles(topology, recentEvent);
  if (roles.length === 0) return getRoleIds(topology);
  return roles;
}

export function allowedEvents(
  topology: Topology,
  recentEvent: string,
): string[] {
  const roleIds = suggestedRoles(topology, recentEvent);
  return collectEventsForRoles(topology.roles, roleIds);
}

export function roleCount(topology: Topology): number {
  return topology.roles.length;
}

export function render(topology: Topology, recentEvent: string): string {
  if (topology.roles.length === 0) return "";
  const suggested = suggestedRoles(topology, recentEvent);
  const allowed = allowedEvents(topology, recentEvent);
  return renderWithContext(topology, recentEvent, suggested, allowed);
}

export function renderWithContext(
  topology: Topology,
  recentEvent: string,
  suggested: string[],
  allowed: string[],
): string {
  if (topology.roles.length === 0) return "";
  return (
    "Topology (advisory):\n" +
    "Recent routing event: " +
    recentEvent +
    "\n" +
    "Suggested next roles: " +
    listText(suggested) +
    "\n" +
    "Allowed next events: " +
    listText(allowed) +
    "\n\n" +
    "Role deck:\n" +
    renderRoles(topology.roles)
  );
}

function defaultTopology(): Topology {
  return {
    name: "",
    completion: "",
    roles: [],
    handoff: {},
    handoffKeys: [],
    gates: [],
  };
}

function loadExisting(path: string, projectDir: string): Topology {
  const text = readFileSync(path, "utf-8");
  const parsed = TOML.parse(text);
  return buildTopology(parsed, projectDir);
}

function buildTopology(
  parsed: Record<string, unknown>,
  projectDir: string,
): Topology {
  const name = typeof parsed.name === "string" ? parsed.name : "";
  const completion =
    typeof parsed.completion === "string" ? parsed.completion : "";

  const rawRoles = (parsed.role ?? []) as Array<Record<string, unknown>>;
  const roles: Role[] = rawRoles
    .filter((r) => typeof r.id === "string" && r.id !== "")
    .map((r) => {
      const role: Role = {
        id: r.id as string,
        prompt: typeof r.prompt === "string" ? r.prompt : "",
        promptFile: typeof r.prompt_file === "string" ? r.prompt_file : "",
        emits: Array.isArray(r.emits) ? r.emits.map(String) : [],
        ...parseRoleBackend(r),
      };
      return { ...role, prompt: rolePrompt(role, projectDir) };
    });

  const rawHandoff = (parsed.handoff ?? {}) as Record<string, unknown>;
  const handoff: Record<string, string[]> = {};
  const handoffKeys: string[] = [];
  for (const [key, value] of Object.entries(rawHandoff)) {
    handoff[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    handoffKeys.push(key);
  }

  const rawGates = (parsed.gate ?? []) as Array<Record<string, unknown>>;
  const gates: Gate[] = rawGates
    .filter((g) => typeof g.event === "string" && g.event !== "")
    .map((g) => {
      const event = g.event as string;
      const requires = Array.isArray(g.requires)
        ? g.requires.map(String).filter((r) => r !== "")
        : [];
      const blocked =
        typeof g.blocked === "string" && g.blocked !== ""
          ? g.blocked
          : deriveBlockedTopic(event);
      return { event, requires, blocked };
    });

  return { name, completion, roles, handoff, handoffKeys, gates };
}

function parseRoleBackend(r: Record<string, unknown>): Partial<Role> {
  const out: Partial<Role> = {};
  if (typeof r.backend_kind === "string" && r.backend_kind !== "") {
    out.backendKind = r.backend_kind;
  }
  if (typeof r.backend_provider === "string" && r.backend_provider !== "") {
    out.backendProvider = r.backend_provider;
  }
  if (typeof r.backend_command === "string" && r.backend_command !== "") {
    out.backendCommand = r.backend_command;
  }
  if (Array.isArray(r.backend_args)) {
    out.backendArgs = r.backend_args.map(String);
  }
  if (
    typeof r.backend_prompt_mode === "string" &&
    r.backend_prompt_mode !== ""
  ) {
    out.backendPromptMode = r.backend_prompt_mode;
  }
  if (
    typeof r.backend_timeout_ms === "number" &&
    Number.isFinite(r.backend_timeout_ms)
  ) {
    out.backendTimeoutMs = r.backend_timeout_ms;
  }
  if (typeof r.backend_agent === "string" && r.backend_agent !== "") {
    out.backendAgent = r.backend_agent;
  }
  if (typeof r.backend_model === "string" && r.backend_model !== "") {
    out.backendModel = r.backend_model;
  }
  return out;
}

export function roleHasBackendOverride(role: Role): boolean {
  return (
    role.backendKind !== undefined ||
    role.backendProvider !== undefined ||
    role.backendCommand !== undefined ||
    role.backendArgs !== undefined ||
    role.backendPromptMode !== undefined ||
    role.backendTimeoutMs !== undefined ||
    role.backendAgent !== undefined ||
    role.backendModel !== undefined
  );
}

function renderRoleBackendLines(role: Role, indent: string): string[] {
  if (!roleHasBackendOverride(role)) return [];
  const lines: string[] = [];
  if (role.backendKind !== undefined) {
    lines.push(`${indent}backend_kind: ${role.backendKind}`);
  }
  if (role.backendProvider !== undefined) {
    lines.push(`${indent}backend_provider: ${role.backendProvider}`);
  }
  if (role.backendCommand !== undefined) {
    lines.push(`${indent}backend_command: ${role.backendCommand}`);
  }
  if (role.backendArgs !== undefined) {
    lines.push(`${indent}backend_args: ${listText(role.backendArgs)}`);
  }
  if (role.backendPromptMode !== undefined) {
    lines.push(`${indent}backend_prompt_mode: ${role.backendPromptMode}`);
  }
  if (role.backendTimeoutMs !== undefined) {
    lines.push(`${indent}backend_timeout_ms: ${role.backendTimeoutMs}`);
  }
  if (role.backendAgent !== undefined) {
    lines.push(`${indent}backend_agent: ${role.backendAgent}`);
  }
  if (role.backendModel !== undefined) {
    lines.push(`${indent}backend_model: ${role.backendModel}`);
  }
  return lines;
}

function rolePrompt(role: Role, projectDir: string): string {
  if (role.prompt) return role.prompt;
  if (!role.promptFile) return "";
  return readPromptFile(projectDir, role.promptFile);
}

function readPromptFile(projectDir: string, promptFile: string): string {
  const fullPath = join(projectDir, promptFile);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf-8");
}

function collectMatchingRoles(topology: Topology, event: string): string[] {
  const acc: string[] = [];
  for (const key of topology.handoffKeys) {
    if (eventMatchesPattern(event, key)) {
      for (const roleId of topology.handoff[key] ?? []) {
        if (!acc.includes(roleId)) acc.push(roleId);
      }
    }
  }
  return acc;
}

function collectEventsForRoles(roles: Role[], roleIds: string[]): string[] {
  const acc: string[] = [];
  for (const role of roles) {
    if (listContains(roleIds, role.id)) {
      for (const e of role.emits) {
        if (!acc.includes(e)) acc.push(e);
      }
    }
  }
  return acc;
}

function eventMatchesPattern(topic: string, pattern: string): boolean {
  if (isRegexPattern(pattern)) {
    return regexMatch(topic, stripRegexDelimiters(pattern));
  }
  return topic === pattern;
}

function isRegexPattern(value: string): boolean {
  return value.length >= 3 && value.startsWith("/") && value.endsWith("/");
}

function stripRegexDelimiters(value: string): string {
  return value.slice(1, -1);
}

function regexMatch(topic: string, pattern: string): boolean {
  try {
    const re = new RegExp(`^${pattern}$`);
    return re.test(topic);
  } catch {
    return false;
  }
}

function renderRoles(roles: Role[]): string {
  let result = "";
  for (const role of roles) {
    result += `- role \`${role.id}\`\n  emits: ${listText(role.emits)}\n`;
    for (const line of renderRoleBackendLines(role, "  ")) {
      result += `${line}\n`;
    }
    result += `  prompt: ${promptSummary(role.prompt)}\n`;
  }
  return result;
}

function promptSummary(prompt: string): string {
  if (!prompt) return "(none)";
  const lines = prompt.split(lineSep());
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "(none)";
}

/* ── inspect topology ─────────────────────────────────────── */

export interface TopologyWarning {
  kind: "orphan-role" | "unreachable-event" | "no-emits";
  message: string;
}

export function validateTopology(topology: Topology): TopologyWarning[] {
  const warnings: TopologyWarning[] = [];

  const targetedRoleIds = handoffTargetIds(topology);
  for (const role of topology.roles) {
    if (!targetedRoleIds.includes(role.id)) {
      warnings.push({
        kind: "orphan-role",
        message: `role \`${role.id}\` is not targeted by any handoff rule`,
      });
    }
    if (role.emits.length === 0) {
      warnings.push({
        kind: "no-emits",
        message: `role \`${role.id}\` has no emits`,
      });
    }
  }

  const emitted = allEmittedEvents(topology);
  for (const event of emitted) {
    if (
      !eventMatchesAny(event, topology.handoffKeys) &&
      event !== topology.completion
    ) {
      warnings.push({
        kind: "unreachable-event",
        message: `event \`${event}\` is emitted but has no matching handoff rule`,
      });
    }
  }

  return warnings;
}

export function renderTopologyInspect(
  projectDir: string,
  format: string,
): void {
  const topology = loadTopology(projectDir);

  if (topology.roles.length === 0) {
    console.log("No topology defined.");
    return;
  }

  switch (format) {
    case "json":
      renderTopologyJson(topology);
      break;
    case "graph":
      renderTopologyGraph(topology);
      break;
    default:
      renderTopologyTerminal(topology);
      break;
  }
}

function renderTopologyJson(topology: Topology): void {
  const warnings = validateTopology(topology);
  const out = {
    name: topology.name,
    completion: topology.completion,
    roles: topology.roles.map((r) => ({
      id: r.id,
      emits: r.emits,
      prompt: promptSummary(r.prompt),
      ...roleBackendJson(r),
    })),
    handoff: topology.handoff,
    warnings: warnings.map((w) => ({ kind: w.kind, message: w.message })),
  };
  console.log(JSON.stringify(out, null, 2));
}

function roleBackendJson(role: Role): Record<string, unknown> {
  if (!roleHasBackendOverride(role)) return {};
  const out: Record<string, unknown> = {};
  if (role.backendKind !== undefined) out.backend_kind = role.backendKind;
  if (role.backendProvider !== undefined)
    out.backend_provider = role.backendProvider;
  if (role.backendCommand !== undefined)
    out.backend_command = role.backendCommand;
  if (role.backendArgs !== undefined) out.backend_args = role.backendArgs;
  if (role.backendPromptMode !== undefined)
    out.backend_prompt_mode = role.backendPromptMode;
  if (role.backendTimeoutMs !== undefined)
    out.backend_timeout_ms = role.backendTimeoutMs;
  if (role.backendAgent !== undefined) out.backend_agent = role.backendAgent;
  if (role.backendModel !== undefined) out.backend_model = role.backendModel;
  return out;
}

function renderTopologyGraph(topology: Topology): void {
  const lines: string[] = [];
  for (const role of topology.roles) {
    for (const event of role.emits) {
      const targets = collectMatchingRoles(topology, event);
      if (event === topology.completion) {
        lines.push(`[${role.id}] --${event}--> (done)`);
      } else if (targets.length > 0) {
        lines.push(`[${role.id}] --${event}--> [${targets.join(", ")}]`);
      } else {
        lines.push(`[${role.id}] --${event}--> (?)`);
      }
    }
  }
  console.log(lines.join("\n"));
}

function renderTopologyTerminal(topology: Topology): void {
  const lines: string[] = [];
  lines.push(`## Topology: ${topology.name || "(unnamed)"}`);
  lines.push("");
  lines.push(`Completion event: ${topology.completion || "(none)"}`);
  lines.push("");

  lines.push("### Roles");
  for (const role of topology.roles) {
    lines.push(`- \`${role.id}\` — emits: ${listText(role.emits)}`);
    for (const line of renderRoleBackendLines(role, "  ")) {
      lines.push(line);
    }
    lines.push(`  prompt: ${promptSummary(role.prompt)}`);
  }
  lines.push("");

  lines.push("### Handoff Map");
  for (const key of topology.handoffKeys) {
    const targets = topology.handoff[key] ?? [];
    const isRegex = key.startsWith("/") && key.endsWith("/");
    const annotation = isRegex ? " (regex)" : "";
    lines.push(`- ${key}${annotation} → [${targets.join(", ")}]`);
  }
  lines.push("");

  const warnings = validateTopology(topology);
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of warnings) {
      lines.push(`- ${w.message}`);
    }
  }

  console.log(lines.join("\n"));
}
