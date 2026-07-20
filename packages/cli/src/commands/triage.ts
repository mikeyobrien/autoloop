// `autoloop triage` — the one-call status mega-command for agents.
//
// Collapses the canonical first three or four read calls (loops, loops
// health, doctor, stats) into a single invocation, and embeds copy-paste
// ready follow-up commands so the next action never needs a docs lookup.

import { join } from "node:path";
import * as config from "@mobrienv/autoloop-core/config";
import { readRunJournal } from "@mobrienv/autoloop-core/journal";
import { readRegistry } from "@mobrienv/autoloop-core/registry/read";
import { healthJson, listRunsJson } from "../loops/json.js";
import { runDoctorChecks } from "./doctor.js";
import { computeStats } from "./stats.js";

export function triageJson(projectDir: string): string {
  const stateDir = config.stateDirPath(projectDir);
  const records = readRegistry(join(stateDir, "registry.jsonl"));
  const doctor = runDoctorChecks(projectDir);
  const failures = doctor.filter((c) => c.status === "fail");
  const warnings = doctor.filter((c) => c.status === "warn");
  const active = records.filter((r) => r.status === "running");

  const commands: string[] = [];
  if (active.length > 0) {
    commands.push(`autoloop loops show ${active[0].run_id} --json`);
    commands.push(`autoloop loops watch ${active[0].run_id}`);
  } else {
    commands.push("autoloop list --json");
    commands.push('autoloop run <preset> "your task"');
  }
  if (failures.length > 0 || warnings.length > 0) {
    commands.push("autoloop doctor --json");
  }

  return JSON.stringify(
    {
      quick_ref: {
        active_runs: active.length,
        total_runs: records.length,
        doctor_failures: failures.length,
        doctor_warnings: warnings.length,
      },
      runs: JSON.parse(listRunsJson(stateDir, false)),
      health: JSON.parse(healthJson(stateDir)),
      doctor: doctor,
      stats: computeStats(records, (runId) => readRunJournal(stateDir, runId)),
      recommended_commands: commands,
    },
    null,
    2,
  );
}

export function renderTriage(projectDir: string): string {
  const parsed = JSON.parse(triageJson(projectDir)) as {
    quick_ref: Record<string, number>;
    recommended_commands: string[];
  };
  const q = parsed.quick_ref;
  const lines = [
    `autoloop triage — ${projectDir}`,
    "",
    `  active runs:     ${q.active_runs} (${q.total_runs} total)`,
    `  doctor:          ${q.doctor_failures} failure(s), ${q.doctor_warnings} warning(s)`,
    "",
    "Next commands:",
    ...parsed.recommended_commands.map((c) => `  ${c}`),
    "",
    "Full detail: autoloop triage --json",
  ];
  return lines.join("\n");
}

export function dispatchTriage(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: autoloop triage [project-dir] [--json]");
    console.log("");
    console.log(
      "One-call project status for agents and operators: active runs,",
    );
    console.log(
      "health, doctor summary, per-preset stats, and the recommended",
    );
    console.log("next commands — equivalent to running loops + loops health +");
    console.log("doctor + stats separately.");
    return;
  }
  let json = false;
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else positionals.push(arg);
  }
  const projectDir = positionals[0] ?? process.env.AUTOLOOP_PROJECT_DIR ?? ".";
  if (json) {
    console.log(triageJson(projectDir));
  } else {
    console.log(renderTriage(projectDir));
  }
}
