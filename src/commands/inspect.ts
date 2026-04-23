import { basename } from "node:path";
import * as topo from "@mobrienv/autoloop-core/topology";
import * as chains from "../chains.js";
import * as render from "../cli/render.js";
import * as config from "../config.js";
import * as memory from "../memory.js";
import * as profiles from "../profiles.js";
import * as tasks from "../tasks.js";
import { printInspectUsage } from "../usage.js";

const INSPECT_TARGETS = [
  "scratchpad",
  "prompt",
  "output",
  "journal",
  "artifacts",
  "memory",
  "tasks",
  "coordination",
  "chain",
  "metrics",
  "profiles",
  "topology",
];

interface InspectSpec {
  artifact: string;
  selector: string;
  projectDir: string;
  format: string;
  run?: string;
  topics?: string[];
  iterFilter?: string;
  allRuns?: boolean;
}

export function dispatchInspect(args: string[]): boolean {
  if (!args[0] || args[0] === "--help" || args[0] === "-h") {
    printInspectUsage();
    return true;
  }

  const spec = parseInspectArgs(args);
  if (!spec.artifact) return true;

  const { artifact, selector, projectDir, format } = spec;

  switch (artifact) {
    case "scratchpad":
      render.renderScratchpadFormat(projectDir, format, spec.run);
      return true;
    case "memory":
      if (format === "json") console.log(memory.rawProject(projectDir));
      else console.log(memory.listProject(projectDir));
      return true;
    case "tasks":
      console.log(tasks.listTasks(projectDir));
      return true;
    case "journal":
      if (format === "json") {
        // Backward compat: raw JSON lines
        if (spec.run) {
          render.renderJournal(projectDir, spec.run);
        } else {
          render.renderAllJournals(projectDir);
        }
      } else {
        render.renderJournalTimeline(projectDir, spec);
      }
      return true;
    case "artifacts":
      render.renderArtifacts(projectDir, format, spec.run);
      return true;
    case "coordination":
      render.renderCoordinationFormat(projectDir, format, spec.run);
      return true;
    case "metrics":
      render.renderMetrics(projectDir, format, selector || spec.run);
      return true;
    case "chain":
      console.log(chains.renderChainState(projectDir));
      return true;
    case "topology":
      topo.renderTopologyInspect(projectDir, format);
      return true;
    case "profiles":
      renderProfilesInspect(projectDir);
      return true;
    case "prompt":
      if (!selector) {
        console.log("inspect prompt requires an iteration selector");
        return true;
      }
      render.renderPromptFormat(projectDir, selector, format, spec.run);
      return true;
    case "output":
      if (!selector) {
        console.log("inspect output requires an iteration selector");
        return true;
      }
      render.renderOutput(projectDir, selector, spec.run);
      return true;
    default: {
      const suggestion = findClosestTarget(artifact, INSPECT_TARGETS);
      console.log(`Unknown inspect target \`${artifact}\`.`);
      if (suggestion) {
        console.log(`Did you mean \`${suggestion}\`?`);
      }
      console.log("");
      console.log(`Valid targets: ${INSPECT_TARGETS.join(", ")}`);
      return true;
    }
  }
}

function parseInspectArgs(args: string[]): InspectSpec {
  const artifact = args[0] ?? "";
  let format = "";
  let run: string | undefined;
  const topics: string[] = [];
  let iterFilter: string | undefined;
  let allRuns = false;
  const positionals: string[] = [];

  let i = 1;
  while (i < args.length) {
    if (args[i] === "--format") {
      format = args[i + 1] ?? "";
      i += 2;
    } else if (args[i] === "--run") {
      run = args[i + 1] ?? "";
      i += 2;
    } else if (args[i] === "--topic") {
      const val = args[i + 1] ?? "";
      if (val) topics.push(val);
      i += 2;
    } else if (args[i] === "--iter") {
      iterFilter = args[i + 1] ?? "";
      i += 2;
    } else if (args[i] === "--all-runs") {
      allRuns = true;
      i++;
    } else if (args[i] === "--json") {
      format = "json";
      i++;
    } else {
      positionals.push(args[i]);
      i++;
    }
  }

  if (!format) {
    format = inspectDefaultFormat(artifact);
  }

  const needsSelector = artifact === "prompt" || artifact === "output";
  const selector =
    needsSelector || artifact === "metrics" ? (positionals[0] ?? "") : "";
  const projectDir = needsSelector
    ? (positionals[1] ?? resolveRuntimeProjectDir())
    : artifact === "metrics" && positionals.length > 1
      ? positionals[1]
      : (positionals[0] ?? resolveRuntimeProjectDir());

  return {
    artifact,
    selector,
    projectDir,
    format,
    run,
    topics: topics.length > 0 ? topics : undefined,
    iterFilter,
    allRuns,
  };
}

function inspectDefaultFormat(artifact: string): string {
  if (artifact === "output") return "text";
  if (artifact === "journal") return "terminal";
  return "terminal";
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function renderProfilesInspect(projectDir: string): void {
  const cfg = config.loadProject(projectDir);
  const defaults = config.getProfileDefaults(cfg);
  const topoData = topo.loadTopology(projectDir);
  const workDir = process.cwd();

  console.log("## Profile Configuration");
  console.log("");
  console.log(
    "Config default profiles: " +
      (defaults.length > 0 ? defaults.join(", ") : "(none)"),
  );
  console.log("");

  if (defaults.length === 0) {
    console.log("No active profiles.");
    return;
  }

  const presetName = basename(projectDir);
  try {
    const resolved = profiles.resolveProfileFragments(
      defaults,
      presetName,
      topoData.roles,
      workDir,
    );
    console.log(`Active profiles: ${defaults.join(", ")}`);
    console.log("");

    if (resolved.warnings.length > 0) {
      console.log("Warnings:");
      for (const w of resolved.warnings) {
        console.log(`  - ${w}`);
      }
      console.log("");
    }

    if (resolved.fragments.size > 0) {
      console.log("Fragments:");
      for (const [roleId, fragment] of resolved.fragments) {
        console.log(`  ${roleId}: ${fragment.trim().split("\n")[0]}...`);
      }
    }
  } catch (err) {
    console.log(
      "Error resolving profiles: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

function findClosestTarget(input: string, targets: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    if (t.startsWith(input) || input.startsWith(t)) {
      const d = Math.abs(t.length - input.length);
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }
  }
  if (best) return best;
  // simple character overlap heuristic
  for (const t of targets) {
    let overlap = 0;
    for (const ch of input) {
      if (t.includes(ch)) overlap++;
    }
    const score = input.length - overlap;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore <= 2 ? best : null;
}
