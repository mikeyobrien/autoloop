import * as config from "@mobrienv/autoloop-core/config";
import {
  HOOK_PHASES,
  type HookPhase,
  type HookSpec,
  isHookPhase,
  validateHookSpecs,
} from "@mobrienv/autoloop-core/hooks-schema";
import {
  clearResumeRequest,
  clearSuspendState,
  readSuspendState,
} from "@mobrienv/autoloop-harness/suspend-state";
import { failUnknown } from "../cli/fail.js";

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function resolveRuntimeStateDir(projectDir: string): string {
  return process.env.AUTOLOOP_STATE_DIR || config.stateDirPath(projectDir);
}

function resolveSpecs(projectDir: string): HookSpec[] {
  const presetFile = process.env.AUTOLOOP_PRESET_FILE;
  return presetFile
    ? config.loadHookSpecsFromFile(presetFile)
    : config.loadHookSpecs(projectDir);
}

function resolveRawToml(projectDir: string): Record<string, unknown> {
  const presetFile = process.env.AUTOLOOP_PRESET_FILE;
  return presetFile
    ? config.loadRawProjectTomlFromFile(presetFile)
    : config.loadRawProjectToml(projectDir);
}

export function dispatchHooks(args: string[]): boolean {
  const sub = args[0] ?? "";
  const json = args.includes("--json");
  const rest = args.slice(1).filter((a) => a !== "--json");

  switch (sub) {
    case "list": {
      const projectDir = rest[0] ?? resolveRuntimeProjectDir();
      return runList(projectDir, json);
    }
    case "show": {
      const projectDir = rest[1] ?? resolveRuntimeProjectDir();
      return runShow(rest[0], projectDir, json);
    }
    case "validate": {
      const projectDir = rest[0] ?? resolveRuntimeProjectDir();
      return runValidate(projectDir, json);
    }
    case "clear-suspend": {
      const projectDir = rest[0] ?? resolveRuntimeProjectDir();
      return runClearSuspend(projectDir, json);
    }
    default:
      if (sub === "" || sub === "--help" || sub === "-h") {
        printHooksUsage();
        return true;
      }
      failUnknown({
        kind: "hooks subcommand",
        input: sub,
        candidates: ["list", "show", "validate", "clear-suspend"],
        helpCommand: "autoloop hooks --help",
      });
      return true;
  }
}

function runList(projectDir: string, json: boolean): boolean {
  const specs = resolveSpecs(projectDir);
  if (json) {
    console.log(JSON.stringify({ hooks: specs }, null, 2));
    return true;
  }
  if (specs.length === 0) {
    console.log("No hooks configured.");
    return true;
  }
  console.log("Configured hooks:");
  for (const phase of HOOK_PHASES) {
    const forPhase = specs.filter((s) => s.phase === phase);
    if (forPhase.length === 0) continue;
    console.log(`  ${phase}:`);
    for (const spec of forPhase) {
      console.log(
        `    - command=${JSON.stringify(spec.command)} on_error=${spec.onError} mutate=${spec.mutate} source=${spec.source}`,
      );
    }
  }
  return true;
}

function runShow(
  phaseArg: string | undefined,
  projectDir: string,
  json: boolean,
): boolean {
  if (!phaseArg || phaseArg === "--help") {
    console.log(`Usage: autoloop hooks show <phase> [project-dir]`);
    console.log(`Phases: ${HOOK_PHASES.join(", ")}`);
    return true;
  }
  if (!isHookPhase(phaseArg)) {
    console.log(
      `error: unknown phase \`${phaseArg}\`; expected one of: ${HOOK_PHASES.join(", ")}`,
    );
    process.exitCode = 1;
    return true;
  }
  const phase: HookPhase = phaseArg;
  const specs = resolveSpecs(projectDir).filter((s) => s.phase === phase);
  if (json) {
    console.log(JSON.stringify({ phase, hooks: specs }, null, 2));
    return true;
  }
  if (specs.length === 0) {
    console.log(`No hooks configured for phase \`${phase}\`.`);
    return true;
  }
  console.log(`Hooks for phase \`${phase}\`:`);
  for (const spec of specs) {
    console.log(`  command:  ${spec.command}`);
    console.log(`  on_error: ${spec.onError}`);
    console.log(`  mutate:   ${spec.mutate}`);
    console.log(`  source:   ${spec.source}`);
    console.log("");
  }
  return true;
}

function runValidate(projectDir: string, json: boolean): boolean {
  const raw = resolveRawToml(projectDir);
  const errors = validateHookSpecs(raw);
  if (json) {
    console.log(
      JSON.stringify({ valid: errors.length === 0, errors }, null, 2),
    );
  } else if (errors.length === 0) {
    console.log("Hooks config is valid.");
  } else {
    console.log(`Found ${errors.length} hook config error(s):`);
    for (const err of errors) {
      console.log(`  - ${err.message}`);
    }
  }
  process.exitCode = errors.length === 0 ? 0 : 1;
  return true;
}

function runClearSuspend(projectDir: string, json: boolean): boolean {
  const stateDir = resolveRuntimeStateDir(projectDir);
  const state = readSuspendState(stateDir);
  const clearedSuspend = clearSuspendState(stateDir);
  const clearedResumeRequest = clearResumeRequest(stateDir);

  if (json) {
    console.log(
      JSON.stringify(
        { clearedSuspend, clearedResumeRequest, previousState: state },
        null,
        2,
      ),
    );
    return true;
  }

  if (!clearedSuspend && !clearedResumeRequest) {
    console.log("No suspend state or resume-request signal to clear.");
    return true;
  }
  if (clearedSuspend) {
    console.log(
      `Cleared suspend state (phase=${state?.phase ?? "unknown"}, reason=${state?.reason ?? "unknown"}).`,
    );
  }
  if (clearedResumeRequest) {
    console.log("Cleared resume-requested signal.");
  }
  return true;
}

export function printHooksUsage(): void {
  console.log(
    "Usage: autoloop hooks <list|show|validate|clear-suspend> [project-dir] [--json]",
  );
  console.log("");
  console.log(
    "Lifecycle hooks: phase-anchored commands run around iterations, runs, and emits.",
  );
  console.log("");
  console.log("Subcommands:");
  console.log("  list                    List all configured hooks by phase");
  console.log("  show <phase>            Show hooks configured for one phase");
  console.log(`                          (phases: ${HOOK_PHASES.join(", ")})`);
  console.log(
    "  validate                Validate [[hook]] entries; non-zero exit on error",
  );
  console.log(
    "  clear-suspend           Clear suspend-state.json and resume-requested",
  );
  console.log("");
  console.log("Flags:");
  console.log("  --json                  Output machine-readable JSON");
}
