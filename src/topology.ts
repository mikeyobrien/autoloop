import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listContains,
  listText,
  skipLine,
  stripQuotes,
  lineSep,
  parseStringListLiteralOrScalar,
} from "./utils.js";

export interface Role {
  id: string;
  prompt: string;
  promptFile: string;
  emits: string[];
}

export interface Topology {
  name: string;
  completion: string;
  roles: Role[];
  handoff: Record<string, string[]>;
  handoffKeys: string[];
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

export function completionEvent(
  topology: Topology,
  fallback: string,
): string {
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
    "Recent routing event: " + recentEvent + "\n" +
    "Suggested next roles: " + listText(suggested) + "\n" +
    "Allowed next events: " + listText(allowed) + "\n\n" +
    "Role deck:\n" +
    renderRoles(topology.roles)
  );
}

function defaultTopology(): Topology {
  return { name: "", completion: "", roles: [], handoff: {}, handoffKeys: [] };
}

function loadExisting(path: string, projectDir: string): Topology {
  const text = readFileSync(path, "utf-8");
  const lines = text.split(lineSep());
  const state = parseLines(lines);
  return finalize(state, projectDir);
}

interface ParseState {
  name: string;
  completion: string;
  roles: Role[];
  currentRole: Role;
  handoff: Record<string, string[]>;
  handoffKeys: string[];
  section: string;
}

function emptyRole(): Role {
  return { id: "", prompt: "", promptFile: "", emits: [] };
}

function parseLines(lines: string[]): ParseState {
  const state: ParseState = {
    name: "",
    completion: "",
    roles: [],
    currentRole: emptyRole(),
    handoff: {},
    handoffKeys: [],
    section: "root",
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (skipLine(trimmed)) continue;

    if (trimmed === "[[role]]") {
      pushCurrentRole(state);
      state.currentRole = emptyRole();
      state.section = "role";
      continue;
    }

    if (trimmed === "[handoff]") {
      pushCurrentRole(state);
      state.currentRole = emptyRole();
      state.section = "handoff";
      continue;
    }

    const parts = trimmed.split("=");
    if (parts.length < 2) continue;
    const key = stripQuotes(parts[0].trim());
    const value = parts.slice(1).join("=").trim();

    if (state.section === "root") {
      if (key === "name") state.name = normalizeScalar(value);
      else if (key === "completion") state.completion = normalizeScalar(value);
    } else if (state.section === "role") {
      if (key === "id") state.currentRole.id = normalizeScalar(value);
      else if (key === "prompt") state.currentRole.prompt = normalizeScalar(value);
      else if (key === "prompt_file") state.currentRole.promptFile = normalizeScalar(value);
      else if (key === "emits") state.currentRole.emits = normalizeList(value);
    } else if (state.section === "handoff") {
      state.handoff[key] = normalizeList(value);
      if (!state.handoffKeys.includes(key)) {
        state.handoffKeys.push(key);
      }
    }
  }

  return state;
}

function pushCurrentRole(state: ParseState): void {
  if (state.currentRole.id !== "") {
    state.roles.push(state.currentRole);
  }
}

function finalize(state: ParseState, projectDir: string): Topology {
  pushCurrentRole(state);
  const roles = state.roles.map((role) => ({
    ...role,
    prompt: rolePrompt(role, projectDir),
  }));
  return {
    name: state.name,
    completion: state.completion,
    roles,
    handoff: state.handoff,
    handoffKeys: state.handoffKeys,
  };
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

function collectMatchingRoles(
  topology: Topology,
  event: string,
): string[] {
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

function collectEventsForRoles(
  roles: Role[],
  roleIds: string[],
): string[] {
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
    const re = new RegExp("^" + pattern + "$");
    return re.test(topic);
  } catch {
    return false;
  }
}

function renderRoles(roles: Role[]): string {
  let result = "";
  for (const role of roles) {
    result +=
      "- role `" + role.id + "`\n" +
      "  emits: " + listText(role.emits) + "\n" +
      "  prompt: " + promptSummary(role.prompt) + "\n";
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

function normalizeScalar(value: string): string {
  return stripQuotes(value);
}

function normalizeList(value: string): string[] {
  return parseStringListLiteralOrScalar(value);
}
