import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as config from "../config.js";
import { jsonField } from "../json.js";
import { joinCsv, generateCompactId } from "../utils.js";
import * as harness from "../harness/index.js";
import { appendText, readLines, extractTopic, extractField } from "../harness/journal.js";
import { checkBudget, defaultBudget } from "./budget.js";
import { parseInlineChain } from "./load.js";
import type { ChainSpec, DynamicChainSpec, StepRecord, ChainTracker } from "./types.js";

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

export function spawnDynamicChain(
  spec: DynamicChainSpec,
  projectDir: string,
  selfCommand: string,
  runOptions: harness.RunOptions,
  parentId: string,
): { outcome: string; reason?: string; chainId?: string; completed?: StepRecord[]; failedStep?: number; failedReason?: string } {
  const budget = spec.budget ?? defaultBudget();
  const tracker = loadChainTracker(projectDir);
  const budgetResult = checkBudget(budget, tracker);

  if (!budgetResult.ok) {
    return { outcome: "budget_exceeded", reason: budgetResult.reason ?? "unknown rejection" };
  }

  const qualityResult = checkQualityGate(projectDir);
  if (!qualityResult.ok) {
    return { outcome: "quality_gate_rejected", reason: qualityResult.reason ?? "unknown rejection" };
  }

  return executeDynamicChain(spec, projectDir, selfCommand, runOptions, parentId);
}

export function writeDynamicSpec(projectDir: string, spec: DynamicChainSpec): string {
  const specsDir = join(chainStateRoot(projectDir), "specs");
  mkdirSync(specsDir, { recursive: true });
  const chainId = spec.chainId ?? ("dyn-" + (countDynamicSpecs(specsDir) + 1));
  const path = join(specsDir, chainId + ".json");
  writeFileSync(path, renderDynamicSpecJson(spec, chainId));
  return chainId;
}

function chainStateRoot(projectDir: string): string {
  return join(config.stateDirPath(projectDir), "chains");
}

function runSteps(
  steps: ChainSpec["steps"],
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

  const stepOptions: harness.RunOptions = { ...runOptions, workDir: stepWorkDir, trigger: "chain" };
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

function writeHandoffArtifact(stepWorkDir: string, stepNum: number, completed: StepRecord[], prompt: string | null): void {
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

function writeResultArtifact(stepWorkDir: string, stepNum: number, stepName: string, result: harness.RunSummary): void {
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

function appendChainEvent(journalFile: string, chainRunId: string, topic: string, fieldsJson: string): void {
  const line =
    "{" + jsonField("chain_run", chainRunId) + ", " +
    jsonField("topic", topic) + ', "fields": {' + fieldsJson + "}}\n";
  appendText(journalFile, line);
}

function loadChainTracker(projectDir: string): ChainTracker {
  const journalFile = config.resolveJournalFile(projectDir);
  const lines = readLines(journalFile);
  const tracker: ChainTracker = { depth: 0, totalSteps: 0, children: 0, consecutiveFailures: 0 };

  for (const line of lines) {
    const topic = extractTopic(line);
    if (topic === "chain.start") {
      tracker.children++;
      tracker.consecutiveFailures = 0;
    } else if (topic === "chain.step.finish") {
      tracker.totalSteps++;
    } else if (topic === "chain.complete") {
      const outcome = extractField(line, "outcome");
      if (outcome === "all_steps_complete") tracker.consecutiveFailures = 0;
      else tracker.consecutiveFailures++;
    }
  }

  return tracker;
}

function checkQualityGate(projectDir: string): { ok: boolean; reason?: string } {
  const tracker = loadChainTracker(projectDir);
  if (tracker.consecutiveFailures >= 2) {
    return { ok: false, reason: `quality gate: ${tracker.consecutiveFailures} consecutive failures — consolidate before spawning` };
  }
  return { ok: true };
}

function executeDynamicChain(
  spec: DynamicChainSpec,
  projectDir: string,
  selfCommand: string,
  runOptions: harness.RunOptions,
  parentId: string,
): { outcome: string; chainId: string; completed?: StepRecord[]; failedStep?: number; failedReason?: string } {
  const chainId = writeDynamicSpec(projectDir, { ...spec, parentId });
  const stepsCsv = spec.steps;
  const journalFile = config.resolveJournalFile(projectDir);
  const justification = spec.justification ?? "";

  appendChainEvent(
    journalFile,
    chainId,
    "chain.spawn",
    jsonField("chain_id", chainId) +
      ", " + jsonField("parent_id", parentId) +
      ", " + jsonField("steps", joinCsv(stepsCsv)) +
      ", " + jsonField("justification", justification),
  );

  const chainSpec = parseInlineChain(joinCsv(stepsCsv), projectDir);
  const namedSpec: ChainSpec = { ...chainSpec, name: chainId };
  const result = runChain(namedSpec, projectDir, selfCommand, runOptions);
  return { ...result, chainId };
}

function countDynamicSpecs(specsDir: string): number {
  if (!existsSync(specsDir)) return 0;
  return readdirSync(specsDir).filter((f) => f.endsWith(".json")).length;
}

function renderDynamicSpecJson(spec: DynamicChainSpec, chainId: string): string {
  return "{" +
    jsonField("chain_id", chainId) + ", " +
    jsonField("parent_id", spec.parentId ?? "") + ", " +
    jsonField("steps", joinCsv(spec.steps)) + ", " +
    jsonField("justification", spec.justification ?? "") +
    "}\n";
}
