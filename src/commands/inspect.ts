import * as harness from "../harness/index.js";
import * as memory from "../memory.js";
import * as chains from "../chains.js";
import { printInspectUsage } from "../usage.js";

interface InspectSpec {
  artifact: string;
  selector: string;
  projectDir: string;
  format: string;
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
      harness.renderScratchpadFormat(projectDir, format);
      return true;
    case "memory":
      if (format === "json") console.log(memory.rawProject(projectDir));
      else console.log(memory.listProject(projectDir));
      return true;
    case "journal":
      harness.renderJournal(projectDir);
      return true;
    case "coordination":
      harness.renderCoordinationFormat(projectDir, format);
      return true;
    case "metrics":
      if (selector) harness.renderMetricsForRun(projectDir, selector, format);
      else harness.renderMetrics(projectDir, format);
      return true;
    case "chain":
      console.log(chains.renderChainState(projectDir));
      return true;
    case "prompt":
      if (!selector) { console.log("inspect prompt requires an iteration selector"); return true; }
      harness.renderPromptFormat(projectDir, selector, format);
      return true;
    case "output":
      if (!selector) { console.log("inspect output requires an iteration selector"); return true; }
      harness.renderOutput(projectDir, selector);
      return true;
    default:
      console.log("unsupported inspect target `" + artifact + "`");
      return true;
  }
}

function parseInspectArgs(args: string[]): InspectSpec {
  const artifact = args[0] ?? "";
  let format = "";
  const positionals: string[] = [];

  let i = 1;
  while (i < args.length) {
    if (args[i] === "--format") {
      format = args[i + 1] ?? "";
      i += 2;
    } else {
      positionals.push(args[i]);
      i++;
    }
  }

  if (!format) {
    format = inspectDefaultFormat(artifact);
  }

  const needsSelector = artifact === "prompt" || artifact === "output";
  const selector = needsSelector ? (positionals[0] ?? "") : (artifact === "metrics" ? (positionals[0] ?? "") : "");
  const projectDir = needsSelector
    ? (positionals[1] ?? resolveRuntimeProjectDir())
    : (artifact === "metrics" && positionals.length > 1
        ? positionals[1]
        : (positionals[0] ?? resolveRuntimeProjectDir()));

  return { artifact, selector, projectDir, format };
}

function inspectDefaultFormat(artifact: string): string {
  if (artifact === "output") return "text";
  if (artifact === "journal") return "json";
  return "terminal";
}

function resolveRuntimeProjectDir(): string {
  return process.env["MINILOOPS_PROJECT_DIR"] || ".";
}
