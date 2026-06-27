// `autoloop robot-docs` — in-tool agent handbook.
//
// Prints a compact, paste-ready guide aimed at AI agents driving this CLI,
// so no external documentation lookup is required. Markdown on stdout.

import { cliVersion } from "./capabilities.js";

export function robotDocsText(): string {
  return `# autoloop — agent handbook (v${cliVersion()})

autoloop runs autonomous LLM loops against a project. You point it at a
preset (a loop recipe) and it iterates a backend agent until completion.

## The four commands you need first

    autoloop triage --json        # one call: active runs, health, doctor, next commands
    autoloop list --json          # available presets with descriptions
    autoloop run <preset> "task"  # start a loop (e.g. autoloop run autocode "fix bug")
    autoloop loops watch <run-id> # follow a live run

## Reading state (all JSON-capable)

    autoloop loops --json             # active runs
    autoloop loops --all --json       # all runs
    autoloop loops show <run-id> --json
    autoloop loops health --json      # stuck/stale detection
    autoloop stats --json             # per-preset success rates and cost
    autoloop verify --json            # independently re-verify a completed run
    autoloop doctor --json            # environment + state diagnostics
    autoloop inspect journal --json   # iteration-by-iteration event log
    autoloop config show --json       # resolved config with provenance

## Driving a live run

    autoloop control show <run-id>          # status + what the run accepts
    autoloop control interrupt <run-id>     # stop after current iteration
    autoloop guide --run <run-id> "advice"  # steer the next iteration

## Contract

- stdout is data; stderr is diagnostics. \`<cmd> --json | jq .\` always works.
- Exit codes: 0 success · 1 user-input error · 2 environment/state error.
- \`autoloop capabilities\` prints the full machine-readable contract.
- Mistyped commands/subcommands fail fast on stderr with a "Did you mean"
  hint — they are never silently interpreted as something else.

## Gotchas

- \`autoloop <name>\` with no command word is shorthand for \`autoloop run <name>\`.
- \`run\` is long-lived; use \`--max-iterations <n>\` to bound it.
- Mutating commands: run, init, memory add/remove, task add/complete,
  worktree merge/clean, runs clean. \`worktree clean\` and \`runs clean\`
  only touch run-scoped state, never your working tree.
`;
}

export function dispatchRobotDocs(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: autoloop robot-docs");
    console.log("");
    console.log("Print a compact agent-targeted handbook for this CLI.");
    return;
  }
  console.log(robotDocsText());
}
