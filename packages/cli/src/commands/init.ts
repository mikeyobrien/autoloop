// `autoloop init` — project onboarding scaffold.
//
// `autoloop init [dir]` writes a fully commented starter `autoloops.toml`
// and gitignores `.autoloop/` so a project is ready for its first run.
// `autoloop init --preset <name> [dir]` scaffolds a custom preset directory
// (autoloops.toml + harness.md + topology.toml + roles/) modeled on the
// bundled presets, with a minimal builder → critic topology.
//
// Existing files are never overwritten — every file is created-or-skipped
// and reported individually so re-running init is always safe.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function dispatchInit(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    printInitUsage();
    return;
  }
  let preset = "";
  let singleFile = "";
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--preset") {
      i++;
      const name = args[i];
      if (!name || name.startsWith("-")) {
        fail("init: --preset requires a name (e.g. --preset myloop)");
        return;
      }
      preset = name;
    } else if (arg === "--single-file") {
      i++;
      const path = args[i];
      if (!path || path.startsWith("-")) {
        fail(
          "init: --single-file requires a destination path (e.g. --single-file preset.toml)",
        );
        return;
      }
      if (!path.endsWith(".toml")) {
        fail(`init: --single-file destination must end in .toml: ${path}`);
        return;
      }
      singleFile = path;
    } else if (arg.startsWith("-")) {
      fail(`init: unknown flag \`${arg}\` — see \`autoloop init --help\``);
      return;
    } else {
      positionals.push(arg);
    }
  }
  if (preset !== "" && singleFile !== "") {
    fail("init: --preset and --single-file are mutually exclusive");
    return;
  }
  if (positionals.length > 1) {
    fail(
      `init: expected at most one directory argument, got: ${positionals.join(" ")}`,
    );
    return;
  }
  const dir = positionals[0] ?? ".";
  if (singleFile !== "") {
    initSingleFilePreset(join(dir, singleFile));
  } else if (preset !== "") {
    initPreset(dir, preset);
  } else {
    initProject(dir);
  }
}

export function initProject(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeIfMissing(dir, "autoloops.toml", starterConfig());
  ensureGitignore(dir);
  console.log("");
  console.log("Next steps:");
  console.log('  autoloop run autocode "describe your objective"');
  console.log("  autoloop list      # browse bundled presets");
  console.log("  autoloop doctor    # check environment and state health");
}

export function initPreset(dir: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    fail(
      `init: invalid preset name \`${name}\` — use letters, digits, dot, dash, underscore`,
    );
    return;
  }
  const presetDir = join(dir, "presets", name);
  mkdirSync(join(presetDir, "roles"), { recursive: true });
  writeIfMissing(presetDir, "autoloops.toml", presetConfig(name));
  writeIfMissing(presetDir, "harness.md", presetHarness(name));
  writeIfMissing(presetDir, "topology.toml", presetTopology(name));
  writeIfMissing(presetDir, join("roles", "builder.md"), builderPrompt());
  writeIfMissing(presetDir, join("roles", "critic.md"), criticPrompt());
  writeIfMissing(presetDir, "README.md", presetReadme(name));
  console.log("");
  console.log("Run it with:");
  console.log(`  autoloop run ./presets/${name} "describe your objective"`);
}

/**
 * Scaffold a single merged-TOML preset: config tables and topology tables
 * (with inline role prompts, never `prompt_file`) in one file, matching the
 * builder → critic shape of `initPreset` but serialized as one document.
 * Suitable for ad hoc / one-off / generated presets — see
 * docs/guides/creating-presets.md.
 */
export function initSingleFilePreset(destPath: string): void {
  const name = basename(destPath, ".toml");
  const dir = dirname(destPath);
  mkdirSync(dir, { recursive: true });
  writeIfMissing(dir, basename(destPath), singleFilePreset(name));
  console.log("");
  console.log("Run it with:");
  console.log(
    `  autoloop run --preset-file ${destPath} "describe your objective"`,
  );
  console.log("");
  console.log("Promote it to a permanent named preset with:");
  console.log(`  autoloop preset promote ${destPath} <name>`);
}

function singleFilePreset(name: string): string {
  return `# ${name} — single-file builder -> critic preset scaffolded by \`autoloop init --single-file\`.
# Everything lives in this one merged TOML document: config tables
# ([event_loop], [backend], [memory], ...) and topology tables (name,
# completion, [[role]], [handoff]). Role prompts must be inline \`prompt\`
# strings here -- \`prompt_file\` is not supported in single-file mode.

name = "${name}"
completion = "task.complete"

[event_loop]
max_iterations = 25
completion_event = "task.complete"
completion_promise = "LOOP_COMPLETE"
# Stop after N consecutive identical backend outputs (0 = disabled).
stall_iterations = 0
# Stop once journaled run cost reaches this USD budget (0 = disabled).
max_cost_usd = 0

[backend]
kind = "command"
command = "claude"
args = ["-p", "--dangerously-skip-permissions"]
prompt_mode = "file"
timeout_ms = 300000

[memory]
prompt_budget_chars = 8000

[[role]]
id = "builder"
emits = ["review.ready", "build.blocked"]
prompt = """
You are the builder.

Do not review your own work -- that is the critic's job.

Your job:
1. Read {{STATE_DIR}}/progress.md (if it exists) and the objective.
2. Implement the next small, verifiable slice of work.
3. Verify it (build, test, or run as appropriate) and record the evidence
   in {{STATE_DIR}}/progress.md.
4. Emit review.ready with a summary of what changed and how it was verified.

On review.rejected reactivation:
- Read the critic's concerns in {{STATE_DIR}}/progress.md and address them.
- Emit review.ready again.

If you cannot make progress, emit build.blocked explaining what is missing.
"""

[[role]]
id = "critic"
emits = ["review.rejected", "task.complete"]
prompt = """
You are the critic.

Do not build -- that is the builder's job.

Your job:
1. Read {{STATE_DIR}}/progress.md and the builder's summary.
2. Independently verify the work: rerun the cited commands, inspect the
   changed files, and look for gaps or regressions.
3. Decide:
   - Work is incomplete, unverified, or wrong -> emit review.rejected
     with specific, actionable concerns recorded in {{STATE_DIR}}/progress.md.
   - The whole objective is met and verified -> emit task.complete
     with a closing summary.

Start skeptical: missing evidence means rejection, not benefit of the doubt.
"""

[handoff]
"loop.start" = ["builder"]
"review.ready" = ["critic"]
"review.rejected" = ["builder"]
"build.blocked" = ["builder"]
`;
}

/** Append `.autoloop/` to .gitignore when `dir` is a git repo (no duplicates). */
export function ensureGitignore(dir: string): void {
  if (!existsSync(join(dir, ".git"))) return;
  const entry = ".autoloop/";
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, `${entry}\n`);
    console.log("created .gitignore (.autoloop/)");
    return;
  }
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n").map((l) => l.trim());
  if (lines.includes(entry) || lines.includes(".autoloop")) {
    console.log(".gitignore already ignores .autoloop/, skipped");
    return;
  }
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${text}${sep}${entry}\n`);
  console.log("updated .gitignore (.autoloop/)");
}

function writeIfMissing(dir: string, relative: string, content: string): void {
  const path = join(dir, relative);
  if (existsSync(path)) {
    console.log(`${path} already exists, skipped`);
    return;
  }
  writeFileSync(path, content);
  console.log(`created ${path}`);
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function starterConfig(): string {
  return `# autoloop project configuration.
# Every key is optional — values below are the defaults. Uncomment to change.

[event_loop]
# Maximum harness iterations before the loop stops.
max_iterations = 3
# Event that marks the run complete (emit via the event tool / \`autoloop emit\`).
completion_event = "task.complete"
# Literal promise string the backend prints to declare completion.
completion_promise = "LOOP_COMPLETE"
# Stop after N consecutive identical backend outputs (0 = disabled).
stall_iterations = 0
# Stop once the journaled run cost reaches this USD budget (0 = disabled).
max_cost_usd = 0
# Per-iteration runtime cap — duration string ("3d", "90m") or ms int.
# Overrides backend.timeout_ms when set (0 = disabled).
# max_iteration_runtime = "12h"
# Loop wall-clock budget — duration string or ms int (0 = disabled).
# max_runtime = "3d"

[backend]
# Command used to drive each iteration.
command = "claude"
# Per-iteration timeout in milliseconds.
timeout_ms = 300000

[memory]
# Character budget for durable memory injected into each prompt.
prompt_budget_chars = 8000
`;
}

function presetConfig(name: string): string {
  return `# ${name} — custom builder → critic preset scaffolded by \`autoloop init\`.

event_loop.max_iterations = 25
event_loop.completion_event = "task.complete"
event_loop.completion_promise = "LOOP_COMPLETE"
# Stop after N consecutive identical backend outputs (0 = disabled).
event_loop.stall_iterations = 0
# Stop once journaled run cost reaches this USD budget (0 = disabled).
event_loop.max_cost_usd = 0
# Per-iteration runtime cap ("3d", "90m", or ms int; overrides backend.timeout_ms).
# event_loop.max_iteration_runtime = "12h"
# Loop wall-clock budget ("12h", "3d", or ms int; 0 = disabled).
# event_loop.max_runtime = "3d"

backend.kind = "command"
backend.command = "claude"
backend.args = ["-p", "--dangerously-skip-permissions"]
backend.prompt_mode = "file"
backend.timeout_ms = 300000

memory.prompt_budget_chars = 8000
harness.instructions_file = "harness.md"
`;
}

function presetTopology(name: string): string {
  return `name = "${name}"
completion = "task.complete"

[[role]]
id = "builder"
emits = ["review.ready", "build.blocked"]
prompt_file = "roles/builder.md"

[[role]]
id = "critic"
emits = ["review.rejected", "task.complete"]
prompt_file = "roles/critic.md"

[handoff]
"loop.start" = ["builder"]
"review.ready" = ["critic"]
"review.rejected" = ["builder"]
"build.blocked" = ["builder"]
`;
}

function presetHarness(name: string): string {
  return `# ${name} harness

Shared rules for every role, loaded on every iteration.

- The objective is given in the prompt; shared state lives in \`{{STATE_DIR}}/\`.
- Keep \`{{STATE_DIR}}/progress.md\` current: what is done, what is next.
- Hand off with the event tool — prose-only handoffs are not routing.
- Prefer small, verifiable changes; verify before claiming success and cite
  the exact commands you ran.
- Only the critic may emit \`task.complete\`.
`;
}

function builderPrompt(): string {
  return `You are the builder.

Do not review your own work — that is the critic's job.

Your job:
1. Read \`{{STATE_DIR}}/progress.md\` (if it exists) and the objective.
2. Implement the next small, verifiable slice of work.
3. Verify it (build, test, or run as appropriate) and record the evidence
   in \`{{STATE_DIR}}/progress.md\`.
4. Emit \`review.ready\` with a summary of what changed and how it was verified.

On \`review.rejected\` reactivation:
- Read the critic's concerns in \`{{STATE_DIR}}/progress.md\` and address them.
- Emit \`review.ready\` again.

If you cannot make progress, emit \`build.blocked\` explaining what is missing.
`;
}

function criticPrompt(): string {
  return `You are the critic.

Do not build — that is the builder's job.

Your job:
1. Read \`{{STATE_DIR}}/progress.md\` and the builder's summary.
2. Independently verify the work: rerun the cited commands, inspect the
   changed files, and look for gaps or regressions.
3. Decide:
   - Work is incomplete, unverified, or wrong → emit \`review.rejected\`
     with specific, actionable concerns recorded in \`{{STATE_DIR}}/progress.md\`.
   - The whole objective is met and verified → emit \`task.complete\`
     with a closing summary.

Start skeptical: missing evidence means rejection, not benefit of the doubt.
`;
}

function presetReadme(name: string): string {
  return `# ${name}

Custom builder → critic preset scaffolded by \`autoloop init --preset ${name}\`.

Shape:
- builder — implements and verifies one slice at a time
- critic — independently verifies and decides completion

Run from the project root:

\`\`\`bash
autoloop run ./presets/${name} "describe your objective"
\`\`\`
`;
}

function printInitUsage(): void {
  console.log("Usage: autoloop init [dir]");
  console.log("       autoloop init --preset <name> [dir]");
  console.log("       autoloop init --single-file <file.toml> [dir]");
  console.log("");
  console.log("Scaffold autoloop files into a project (default dir: `.`).");
  console.log("");
  console.log("  autoloop init             write a commented starter");
  console.log("                            autoloops.toml and gitignore");
  console.log("                            .autoloop/ (git repos only)");
  console.log("  autoloop init --preset x  scaffold a custom preset at");
  console.log("                            <dir>/presets/x/ (autoloops.toml,");
  console.log("                            harness.md, topology.toml, roles/)");
  console.log("  autoloop init --single-file p.toml");
  console.log("                            scaffold one merged-TOML preset");
  console.log("                            file at <dir>/p.toml with inline");
  console.log("                            role prompts (no prompt_file)");
  console.log("");
  console.log("Existing files are never overwritten.");
}
