import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as config from "./config.js";
import { jsonField, decodeJsonValue } from "./json.js";
import {
  skipLine,
  stripQuotes,
  lineSep,
  joinCsv,
  parseStringList,
  parseStringListLiteralOrScalar,
  generateCompactId,
  shellQuote,
} from "./utils.js";
import * as harness from "./harness/index.js";
import { appendText, readLines, extractTopic, extractField } from "./harness/journal.js";

export interface ChainStep {
  name: string;
  presetDir: string;
}

export interface ChainSpec {
  name: string;
  steps: ChainStep[];
}

export interface Budget {
  maxDepth: number;
  maxSteps: number;
  maxRuntimeMs: number;
  maxChildren: number;
  maxConsecutiveFailures: number;
}

export interface ChainsConfig {
  chains: ChainSpec[];
  budget: Budget;
}

export function defaultBudget(): Budget {
  return {
    maxDepth: 5,
    maxSteps: 50,
    maxRuntimeMs: 3600000,
    maxChildren: 10,
    maxConsecutiveFailures: 3,
  };
}

export function load(projectDir: string): ChainsConfig {
  const path = join(projectDir, "chains.toml");
  if (!existsSync(path)) return { chains: [], budget: defaultBudget() };
  return loadExisting(path, projectDir);
}

export function resolveChain(
  chains: ChainsConfig,
  name: string,
): ChainSpec | null {
  return chains.chains.find((c) => c.name === name) ?? null;
}

export function listChains(chains: ChainsConfig): ChainSpec[] {
  return chains.chains;
}

export function parseInlineChain(
  csvSteps: string,
  projectDir: string,
): ChainSpec {
  const stepNames = parseStringList(csvSteps);
  return {
    name: "inline",
    steps: resolveSteps(stepNames, projectDir),
  };
}

export function runChain(
  chainSpec: ChainSpec,
  projectDir: string,
  selfCommand: string,
  runOptions: harness.RunOptions,
): { completed: StepRecord[]; outcome: string; failedStep?: number; failedReason?: string } {
  const chainName = chainSpec.name;
  const steps = chainSpec.steps;
  const cfg = config.loadProject(projectDir);
  const chainRunId = nextChainRunId(projectDir, cfg);
  const chainDir = join(chainStateRoot(projectDir), chainRunId);
  const journalFile = config.resolveJournalFile(projectDir);

  mkdirSync(chainDir, { recursive: true });
  appendChainEvent(
    journalFile,
    chainRunId,
    "chain.start",
    jsonField("name", chainName) +
      ", " + jsonField("steps", joinCsv(steps.map((s) => s.name))) +
      ", " + jsonField("step_count", String(steps.length)),
  );

  const result = runSteps(steps, 1, projectDir, chainDir, chainRunId, selfCommand, runOptions, journalFile, []);

  appendChainEvent(
    journalFile,
    chainRunId,
    "chain.complete",
    jsonField("name", chainName) +
      ", " + jsonField("steps_completed", String(result.completed.length)) +
      ", " + jsonField("outcome", result.outcome),
  );

  return result;
}

export function renderChainState(projectDir: string): string {
  const journalFile = config.resolveJournalFile(projectDir);
  const lines = readLines(journalFile);
  return renderChainLines(lines);
}

export function loadBudget(projectDir: string): Budget {
  const path = join(projectDir, "chains.toml");
  if (!existsSync(path)) return defaultBudget();
  return parseBudget(readFileSync(path, "utf-8").split(lineSep()));
}

export function checkBudget(
  budget: Budget,
  tracker: ChainTracker,
): { ok: boolean; reason?: string } {
  if (tracker.depth >= budget.maxDepth) {
    return { ok: false, reason: `max_depth exceeded (${tracker.depth}/${budget.maxDepth})` };
  }
  if (tracker.totalSteps >= budget.maxSteps) {
    return { ok: false, reason: `max_steps exceeded (${tracker.totalSteps}/${budget.maxSteps})` };
  }
  if (tracker.children >= budget.maxChildren) {
    return { ok: false, reason: `max_children exceeded (${tracker.children}/${budget.maxChildren})` };
  }
  if (tracker.consecutiveFailures >= budget.maxConsecutiveFailures) {
    return { ok: false, reason: `max_consecutive_failures exceeded (${tracker.consecutiveFailures}/${budget.maxConsecutiveFailures})` };
  }
  return { ok: true };
}

export function listKnownPresets(): string[] {
  return [
    "autocode", "autosimplify", "autoideas", "autoresearch",
    "autoqa", "autotest", "autofix", "autoreview",
    "autodoc", "autosec", "autoperf", "autospec",
  ];
}

export function validatePresetVocabulary(
  steps: string[],
  projectDir: string,
): { ok: boolean; reason?: string } {
  const known = listKnownPresets();
  for (const name of steps) {
    if (!known.includes(name) && !config.projectHasConfig(resolvePresetDir(name, projectDir))) {
      return { ok: false, reason: "unknown preset: " + name };
    }
  }
  return { ok: true };
}

// --- Private ---

interface StepRecord {
  step: number;
  name: string;
  stopReason: string;
}

interface ChainTracker {
  depth: number;
  totalSteps: number;
  children: number;
  consecutiveFailures: number;
}

function chainStateRoot(projectDir: string): string {
  return join(config.stateDirPath(projectDir), "chains");
}

function loadExisting(path: string, projectDir: string): ChainsConfig {
  const text = readFileSync(path, "utf-8");
  const lines = text.split(lineSep());
  return parseChains(lines, projectDir);
}

function parseChains(lines: string[], projectDir: string): ChainsConfig {
  const chains: Array<{ name: string; steps: string[] }> = [];
  let current: { name: string; steps: string[] } | null = null;
  let budget = defaultBudget();
  let section = "root";

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (skipLine(trimmed)) continue;

    if (trimmed === "[[chain]]") {
      if (current && current.name) chains.push(current);
      current = { name: "", steps: [] };
      section = "chain";
      continue;
    }
    if (trimmed === "[budget]") {
      if (current && current.name) chains.push(current);
      current = null;
      section = "budget";
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (section === "chain" && current) {
      if (key === "name") current.name = stripQuotes(value);
      else if (key === "steps") current.steps = parseStringListLiteralOrScalar(value);
    } else if (section === "budget") {
      budget = assignBudgetKey(budget, key, stripQuotes(value));
    }
  }

  if (current && current.name) chains.push(current);

  return {
    chains: chains.map((c) => ({
      name: c.name,
      steps: resolveSteps(c.steps, projectDir),
    })),
    budget,
  };
}

function assignBudgetKey(budget: Budget, key: string, value: string): Budget {
  const num = parseInt(value, 10);
  if (isNaN(num)) return budget;
  switch (key) {
    case "max_depth": return { ...budget, maxDepth: num };
    case "max_steps": return { ...budget, maxSteps: num };
    case "max_runtime_ms": return { ...budget, maxRuntimeMs: num };
    case "max_children": return { ...budget, maxChildren: num };
    case "max_consecutive_failures": return { ...budget, maxConsecutiveFailures: num };
    default: return budget;
  }
}

function resolveSteps(stepNames: string[], projectDir: string): ChainStep[] {
  return stepNames.map((name) => ({
    name,
    presetDir: resolvePresetDir(name, projectDir),
  }));
}

function resolvePresetDir(name: string, projectDir: string): string {
  const candidate = join(projectDir, "presets/" + name);
  if (existsSync(candidate)) return candidate;
  const cwdCandidate = join(".", "presets/" + name);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  return name;
}

function runSteps(
  steps: ChainStep[],
  stepNum: number,
  projectDir: string,
  chainDir: string,
  chainRunId: string,
  selfCommand: string,
  runOptions: harness.RunOptions,
  journalFile: string,
  completed: StepRecord[],
): { completed: StepRecord[]; outcome: string; failedStep?: number; failedReason?: string } {
  if (steps.length === 0) {
    return { completed, outcome: "all_steps_complete" };
  }

  const [step, ...rest] = steps;
  const stepName = step.name;
  const presetDir = step.presetDir;
  const stepWorkDir = join(chainDir, "step-" + stepNum);
  mkdirSync(stepWorkDir, { recursive: true });

  writeHandoffArtifact(stepWorkDir, stepNum, completed, runOptions.prompt ?? null);
  appendChainEvent(
    journalFile,
    chainRunId,
    "chain.step.start",
    jsonField("step", String(stepNum)) +
      ", " + jsonField("preset", stepName) +
      ", " + jsonField("preset_dir", presetDir) +
      ", " + jsonField("work_dir", stepWorkDir),
  );

  const stepOptions: harness.RunOptions = { ...runOptions, workDir: stepWorkDir };
  const prompt = stepNum === 1 ? (runOptions.prompt ?? null) : null;
  const result = harness.run(presetDir, prompt, selfCommand, stepOptions);
  const stopReason = result.stopReason;

  writeResultArtifact(stepWorkDir, stepNum, stepName, result);
  appendChainEvent(
    journalFile,
    chainRunId,
    "chain.step.finish",
    jsonField("step", String(stepNum)) +
      ", " + jsonField("preset", stepName) +
      ", " + jsonField("stop_reason", stopReason),
  );

  const record: StepRecord = { step: stepNum, name: stepName, stopReason };
  const updatedCompleted = [...completed, record];

  if (chainStepSuccess(stopReason)) {
    return runSteps(rest, stepNum + 1, projectDir, chainDir, chainRunId, selfCommand, runOptions, journalFile, updatedCompleted);
  }
  return { completed: updatedCompleted, outcome: "step_failed", failedStep: stepNum, failedReason: stopReason };
}

function chainStepSuccess(stopReason: string): boolean {
  return stopReason === "max_iterations" || stopReason === "completion_event" || stopReason === "completion_promise";
}

function writeHandoffArtifact(
  stepWorkDir: string,
  stepNum: number,
  completed: StepRecord[],
  prompt: string | null,
): void {
  let content = "# Chain Handoff — Step " + stepNum + "\n\n";
  if (prompt) content += "## Entry Objective\n\n" + prompt + "\n\n";
  if (completed.length === 0) {
    content += "First step in chain. No prior results.\n";
  } else {
    content += "## Prior Steps\n";
    for (const rec of completed) {
      content += "- Step " + rec.step + " (" + rec.name + "): " + rec.stopReason + "\n";
    }
  }
  writeFileSync(join(stepWorkDir, "handoff.md"), content);
}

function writeResultArtifact(
  stepWorkDir: string,
  stepNum: number,
  stepName: string,
  result: harness.RunSummary,
): void {
  const content =
    "# Chain Result — Step " + stepNum + " (" + stepName + ")\n\n" +
    "Stop reason: " + result.stopReason + "\n" +
    "Iterations: " + result.iterations + "\n";
  writeFileSync(join(stepWorkDir, "result.md"), content);
}

function nextChainRunId(projectDir: string, cfg: config.Config): string {
  if (config.get(cfg, "core.run_id_format", "compact") === "counter") {
    const journalFile = config.resolveJournalFile(projectDir);
    const lines = readLines(journalFile);
    const count = lines.filter((l) => extractTopic(l) === "chain.start").length;
    return "chain-" + (count + 1);
  }
  return generateCompactId("chain");
}

function appendChainEvent(
  journalFile: string,
  chainRunId: string,
  topic: string,
  fieldsJson: string,
): void {
  const line =
    "{" + jsonField("chain_run", chainRunId) + ", " +
    jsonField("topic", topic) + ', "fields": {' + fieldsJson + "}}\n";
  appendText(journalFile, line);
}

function renderChainLines(lines: string[]): string {
  const entries: Array<{ topic: string; line: string }> = [];
  for (const line of lines) {
    const topic = extractTopic(line);
    if (isChainTopic(topic)) {
      entries.push({ topic, line });
    }
  }
  if (entries.length === 0) return "(no chain runs found)";
  let result = "# Chain State\n\n";
  for (const entry of entries) {
    result += renderChainEntry(entry.topic, entry.line);
  }
  return result;
}

function isChainTopic(topic: string): boolean {
  return [
    "chain.start", "chain.step.start", "chain.step.finish",
    "chain.complete", "chain.spawn",
  ].includes(topic);
}

function renderChainEntry(topic: string, line: string): string {
  switch (topic) {
    case "chain.start":
      return "## Chain: " + extractField(line, "name") + "\n" + "Steps: " + extractField(line, "steps") + "\n\n";
    case "chain.step.start":
      return "- Step " + extractField(line, "step") + " (" + extractField(line, "preset") + ") started\n";
    case "chain.step.finish":
      return "- Step " + extractField(line, "step") + " (" + extractField(line, "preset") + ") finished: " + extractField(line, "stop_reason") + "\n";
    case "chain.complete":
      return "\nOutcome: " + extractField(line, "outcome") + " (" + extractField(line, "steps_completed") + " steps completed)\n\n";
    case "chain.spawn":
      return "- Spawned: " + extractField(line, "chain_id") + " (parent: " + extractField(line, "parent_id") + ", steps: " + extractField(line, "steps") + ")\n";
    default:
      return "";
  }
}

function parseBudget(lines: string[]): Budget {
  let budget = defaultBudget();
  let inSection = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === "[budget]") { inSection = true; continue; }
    if (trimmed === "[[chain]]") { inSection = false; continue; }
    if (!inSection || skipLine(trimmed)) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    budget = assignBudgetKey(budget, trimmed.slice(0, eqIndex).trim(), stripQuotes(trimmed.slice(eqIndex + 1).trim()));
  }
  return budget;
}
