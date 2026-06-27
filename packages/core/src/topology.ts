import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import TOML from "@iarna/toml";
import type {
  FanoutKind,
  FanoutStage,
  JoinKind,
  VoteThreshold,
} from "./fanout.js";
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
  stages: FanoutStage[];
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

/**
 * Load a topology from a single merged-TOML preset file. The file carries both
 * config and topology tables in one document; only the topology tables
 * (`name`/`completion`/`role`/`handoff`/`gate`) are read here — the config
 * tables are ignored. Role prompts must be inline (`prompt = "..."`);
 * `prompt_file` is unsupported in single-file mode because there is no sibling
 * preset directory to resolve it against (the validator flags such roles).
 */
export function loadTopologyFromFile(file: string): Topology {
  if (!existsSync(file)) return defaultTopology();
  return loadExisting(file, dirname(file));
}

/** True when `target` points at an existing single-file (`.toml`) preset. */
export function isSingleFilePresetPath(target: string): boolean {
  if (!target.endsWith(".toml")) return false;
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
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
    stages: [],
  };
}

function loadExisting(path: string, projectDir: string): Topology {
  const text = readFileSync(path, "utf-8");
  const parsed = TOML.parse(text);
  return buildTopology(parsed, projectDir);
}

export function buildTopology(
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

  const rawStages = (parsed.stage ?? []) as Array<Record<string, unknown>>;
  const stages: FanoutStage[] = rawStages
    .filter((s) => typeof s.id === "string" && s.id !== "")
    .map(parseStage);

  return { name, completion, roles, handoff, handoffKeys, gates, stages };
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseStage(s: Record<string, unknown>): FanoutStage {
  const id = s.id as string;
  const kind: FanoutKind = s.kind === "verdict" ? "verdict" : "discovery";
  const join = str(s.join, "concat") as JoinKind;
  const onPass = str(s.on_pass, `${id}.passed`);
  const onFail = str(s.on_fail, `${id}.blocked`);
  const voteThreshold = ((): VoteThreshold => {
    if (s.vote_threshold === "supermajority") return "supermajority";
    if (s.vote_threshold === "unanimous") return "unanimous";
    return "majority";
  })();
  return {
    id,
    kind,
    branches: num(s.branches, 0),
    role: str(s.role, ""),
    roles: Array.isArray(s.roles) ? s.roles.map(String) : [],
    join,
    requires: Array.isArray(s.requires)
      ? s.requires.map(String).filter((r) => r !== "")
      : [],
    voteField: str(s.vote_field, "affirm"),
    voteThreshold,
    itemsField: str(s.items_field, "items"),
    keyField: str(s.key_field, "key"),
    countMin: num(s.count_min, 1),
    quorum: num(s.quorum, 0),
    onPass,
    onFail,
    synthesizerRole: str(s.synthesizer_role, ""),
  };
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
  kind:
    | "orphan-role"
    | "unreachable-event"
    | "no-emits"
    | "completion-unreachable"
    | "gate-dead-event"
    | "gate-blocked-unroutable"
    | "prompt-file-in-single-file"
    | "stage-unknown-role"
    | "stage-event-unroutable"
    | "stage-empty"
    | "stage-schema-incoherent"
    | "stage-not-executed";
  message: string;
}

export interface ValidateTopologyOptions {
  /**
   * Single-file preset mode: flag roles that rely on `prompt_file`, which is
   * unsupported when the preset is one file with no sibling directory.
   */
  singleFile?: boolean;
}

export function validateTopology(
  topology: Topology,
  options: ValidateTopologyOptions = {},
): TopologyWarning[] {
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
    if (options.singleFile && !role.prompt && role.promptFile) {
      warnings.push({
        kind: "prompt-file-in-single-file",
        message: `role \`${role.id}\` uses prompt_file \`${role.promptFile}\`, unsupported in single-file presets; use an inline prompt`,
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

  // Completion must be emittable by some role; otherwise the loop can never
  // reach its completion event and runs until another guard stops it.
  if (topology.completion !== "" && !emitted.includes(topology.completion)) {
    warnings.push({
      kind: "completion-unreachable",
      message: `completion event \`${topology.completion}\` is never emitted by any role`,
    });
  }

  // Evidence gates: the gated event must be emittable, and the typed blocked
  // topic must route somewhere (a handoff rule or the completion event).
  for (const gate of topology.gates) {
    if (!emitted.includes(gate.event)) {
      warnings.push({
        kind: "gate-dead-event",
        message: `gate event \`${gate.event}\` is never emitted by any role`,
      });
    }
    if (
      !eventMatchesAny(gate.blocked, topology.handoffKeys) &&
      gate.blocked !== topology.completion
    ) {
      warnings.push({
        kind: "gate-blocked-unroutable",
        message: `gate blocked topic \`${gate.blocked}\` has no matching handoff rule and is not the completion event`,
      });
    }
  }

  validateStages(topology, warnings);

  // Fan-out stages parse and validate, but stage EXECUTION is not yet wired into
  // the run loop. On the runnable (single-file) path, flag a preset that defines
  // stages so the dead-topology gate refuses it rather than silently no-opping.
  if (options.singleFile && topology.stages.length > 0) {
    warnings.push({
      kind: "stage-not-executed",
      message: `topology defines ${topology.stages.length} fan-out [[stage]] block(s), but stage execution is not yet wired into the run loop; they would not run`,
    });
  }

  return warnings;
}

function validateStages(topology: Topology, warnings: TopologyWarning[]): void {
  const roleIds = new Set(getRoleIds(topology));
  const routes = (event: string): boolean =>
    eventMatchesAny(event, topology.handoffKeys) ||
    event === topology.completion;

  for (const stage of topology.stages) {
    // Every referenced role must exist.
    const referenced = [
      ...(stage.role ? [stage.role] : []),
      ...stage.roles,
      ...(stage.synthesizerRole ? [stage.synthesizerRole] : []),
    ];
    for (const roleId of referenced) {
      if (!roleIds.has(roleId)) {
        warnings.push({
          kind: "stage-unknown-role",
          message: `stage \`${stage.id}\` references role \`${roleId}\` that no [[role]] defines`,
        });
      }
    }

    // A stage must launch something: a K-identical panel (role + branches) or
    // an N-distinct panel (roles).
    const hasIdentical = stage.role !== "" && stage.branches > 0;
    if (!hasIdentical && stage.roles.length === 0) {
      warnings.push({
        kind: "stage-empty",
        message: `stage \`${stage.id}\` launches no branches; set role+branches or roles`,
      });
    }

    // The stage's outcome events must route somewhere.
    for (const event of [stage.onPass, stage.onFail]) {
      if (!routes(event)) {
        warnings.push({
          kind: "stage-event-unroutable",
          message: `stage \`${stage.id}\` event \`${event}\` has no matching handoff rule and is not the completion event`,
        });
      }
    }

    // Seam coherence: the reducer's required fields must be guaranteed by the
    // branch schema, else votes/dedup operate on data that may be absent.
    if (stage.requires.length > 0) {
      if (
        stage.join === "majority-vote" &&
        !stage.requires.includes(stage.voteField)
      ) {
        warnings.push({
          kind: "stage-schema-incoherent",
          message: `stage \`${stage.id}\` votes on \`${stage.voteField}\` but its schema does not require it`,
        });
      }
      if (
        (stage.join === "dedup-by-key" || stage.join === "count-threshold") &&
        !stage.requires.includes(stage.itemsField)
      ) {
        warnings.push({
          kind: "stage-schema-incoherent",
          message: `stage \`${stage.id}\` reduces \`${stage.itemsField}\` but its schema does not require it`,
        });
      }
    }
  }
}

export function renderTopologyInspect(target: string, format: string): void {
  const singleFile = isSingleFilePresetPath(target);
  const topology = singleFile
    ? loadTopologyFromFile(target)
    : loadTopology(target);

  if (topology.roles.length === 0) {
    console.log("No topology defined.");
    return;
  }

  switch (format) {
    case "json":
      renderTopologyJson(topology, singleFile);
      break;
    case "graph":
      renderTopologyGraph(topology);
      break;
    default:
      renderTopologyTerminal(topology, singleFile);
      break;
  }
}

function renderTopologyJson(topology: Topology, singleFile: boolean): void {
  const warnings = validateTopology(topology, { singleFile });
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

function renderTopologyTerminal(topology: Topology, singleFile: boolean): void {
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

  const warnings = validateTopology(topology, { singleFile });
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of warnings) {
      lines.push(`- ${w.message}`);
    }
  }

  console.log(lines.join("\n"));
}
