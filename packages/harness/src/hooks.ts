import { spawnSync } from "node:child_process";
import type { HookPhase } from "@mobrienv/autoloop-core/hooks-schema";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { log, printHookOutput } from "./display.js";
import { writeSuspendState } from "./suspend-state.js";
import type { LoopContext } from "./types.js";

export interface HookEnv {
  AUTOLOOP_PROJECT_DIR: string;
  AUTOLOOP_RUN_ID: string;
  AUTOLOOP_PRESET: string;
  AUTOLOOP_TASKS_FILE: string;
  AUTOLOOP_ITERATION?: string;
  AUTOLOOP_GIT_SHA_BEFORE?: string;
  AUTOLOOP_GIT_SHA_AFTER?: string;
  /** Run stop reason, set on post_run (e.g. "completed" = success). */
  AUTOLOOP_STOP_REASON?: string;
}

export function buildHookEnv(
  loop: LoopContext,
  extra?: {
    iteration?: number;
    gitShaBefore?: string;
    gitShaAfter?: string;
    stopReason?: string;
  },
): HookEnv {
  const env: HookEnv = {
    // The work dir is the repo being worked (where .autoloop/issue-sync.toml lives);
    // projectDir can be the preset directory, which is not what hooks want.
    AUTOLOOP_PROJECT_DIR: loop.paths.workDir,
    AUTOLOOP_RUN_ID: loop.runtime.runId,
    AUTOLOOP_PRESET: loop.launch.preset,
    AUTOLOOP_TASKS_FILE: loop.paths.tasksFile,
  };
  if (extra?.iteration !== undefined) {
    env.AUTOLOOP_ITERATION = String(extra.iteration);
  }
  if (extra?.gitShaBefore !== undefined) {
    env.AUTOLOOP_GIT_SHA_BEFORE = extra.gitShaBefore;
  }
  if (extra?.gitShaAfter !== undefined) {
    env.AUTOLOOP_GIT_SHA_AFTER = extra.gitShaAfter;
  }
  if (extra?.stopReason !== undefined) {
    env.AUTOLOOP_STOP_REASON = extra.stopReason;
  }
  return env;
}

export function captureGitSha(cwd: string): string {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {
    /* not a git repo or git not available — return empty */
  }
  return "";
}

interface RawHookRun {
  status: number;
  combined: string;
  failed: boolean;
}

function spawnHook(
  loop: LoopContext,
  name: string,
  cmd: string,
  hookEnv: HookEnv,
): RawHookRun {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(hookEnv)) {
    if (v !== undefined) env[k] = v;
  }

  const result = spawnSync(cmd, {
    shell: true,
    cwd: loop.paths.workDir,
    encoding: "utf-8",
    env,
  });

  const combined =
    (result.stdout ?? "") +
    (result.stderr ? `\n[stderr]\n${result.stderr}` : "");

  const failed = result.status !== 0 || Boolean(result.error);
  if (failed && result.error) {
    log(loop, "debug", `hook ${name} spawn error: ${result.error.message}`);
  }

  return { status: result.status ?? -1, combined, failed };
}

/**
 * Legacy single-hook entry point (`runHook`). Kept for backward compatibility
 * with any external callers/tests; internally the engine runs hooks through
 * `runPhaseHooks` which layers policy + mutation on top of this same spawn +
 * journal behavior.
 */
export function runHook(
  loop: LoopContext,
  name: string,
  cmd: string,
  hookEnv: HookEnv,
  iteration?: string,
): void {
  if (!cmd) return;

  log(loop, "debug", `hook ${name} start cmd=${JSON.stringify(cmd)}`);
  const { status, combined, failed } = spawnHook(loop, name, cmd, hookEnv);

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    iteration ?? "",
    "hook.output",
    `"hook": ${JSON.stringify(name)}, "exit_code": ${status}, "output": ${JSON.stringify(combined.trim())}`,
  );

  printHookOutput(name, status, combined.trim(), failed);

  if (failed) {
    const msg = firstFailureLine(name, status, combined);
    log(loop, "warn", msg);
    if (loop.hooks.strict && name === "pre_run") {
      throw new Error(`Aborting run: ${msg}`);
    }
  } else {
    log(loop, "debug", `hook ${name} ok`);
  }
}

function firstFailureLine(
  name: string,
  status: number,
  combined: string,
): string {
  const stderrIdx = combined.indexOf("\n[stderr]\n");
  const detail =
    (stderrIdx >= 0 ? combined.slice(stderrIdx + 10) : "").trim() ||
    (stderrIdx >= 0 ? combined.slice(0, stderrIdx) : combined).trim();
  const firstLine =
    detail
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return `hook ${name} failed (exit ${status}): ${firstLine}`;
}

// --- Mutation directive parsing --------------------------------------------

const MUTATE_FENCE_RE = /<<<AUTOLOOP_MUTATE>>>\n?([\s\S]*?)\n?<<<END>>>/;

/**
 * Parse a mutation directive from hook stdout, given which kind of mutation
 * this hook is configured for:
 *
 * - `mutate="prompt"`: a fenced block (`<<<AUTOLOOP_MUTATE>>> ... <<<END>>>`)
 *   or a `{"prompt": "..."}` JSON line take precedence; otherwise the *entire*
 *   trimmed stdout becomes the new prompt (so a hook can be as simple as
 *   `echo "new prompt text"`).
 * - `mutate="event"`: requires a JSON object with `topic` and/or `payload`
 *   (there is no plain-text form — an emitted event is structured, not free
 *   text).
 *
 * Empty/malformed stdout is not an error — it simply yields no mutation
 * (returns null), since a hook may run for its side effects alone.
 */
export function parseMutationDirective(
  stdout: string,
  mutate: "prompt" | "event",
): { prompt?: string; topic?: string; payload?: string } | null {
  if (!stdout?.trim()) return null;
  const trimmed = stdout.trim();

  const fenced = MUTATE_FENCE_RE.exec(stdout);
  if (fenced && mutate === "prompt") {
    return { prompt: fenced[1] };
  }

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const out: { prompt?: string; topic?: string; payload?: string } = {};
      if (typeof obj.prompt === "string") out.prompt = obj.prompt;
      if (typeof obj.topic === "string") out.topic = obj.topic;
      if (typeof obj.payload === "string") out.payload = obj.payload;
      if (Object.keys(out).length > 0) return out;
    } catch {
      /* not JSON — fall through to the plain-text prompt case below */
    }
  }

  if (mutate === "prompt") return { prompt: trimmed };
  return null;
}

export interface PhaseHookResult {
  /** Mutated prompt, when a `mutate="prompt"` hook produced one (pre_iteration). */
  mutatedPrompt?: string;
  /** Mutated event, when a `mutate="event"` hook produced one (pre_emit). */
  mutatedEvent?: { topic?: string; payload?: string };
  /** True when a `block` hook failed — caller must abort/fail. */
  blocked: boolean;
  /** Detail message for the first blocking failure, if any. */
  blockedMessage?: string;
  /** True when a `suspend` hook fired and the run should stop (out-of-process
   * phases can't block; the caller is responsible for tearing down). */
  suspended: boolean;
}

export interface RunPhaseHooksOptions {
  iteration?: number;
  gitShaBefore?: string;
  gitShaAfter?: string;
  stopReason?: string;
}

/**
 * Run every hook configured for `phase`, in declaration order, applying each
 * hook's error policy and (if configured) parsing a mutation directive from
 * its stdout. Later hooks in the same phase see the not-yet-applied original
 * inputs — mutation from multiple hooks in one phase is last-write-wins
 * (whichever hook mutates last), which keeps the model simple and matches
 * the common case of a single hook per phase.
 */
export async function runPhaseHooks(
  loop: LoopContext,
  phase: HookPhase,
  hookEnv: HookEnv,
  opts: RunPhaseHooksOptions = {},
): Promise<PhaseHookResult> {
  // Defensive default: hand-built test LoopContexts (and any older caller
  // that predates `hooks.specs`) may omit it entirely.
  const specs = (loop.hooks.specs ?? []).filter((s) => s.phase === phase);
  const result: PhaseHookResult = { blocked: false, suspended: false };
  const iterationStr =
    opts.iteration !== undefined ? String(opts.iteration) : "";

  for (const spec of specs) {
    if (!spec.command) continue;
    log(
      loop,
      "debug",
      `hook ${phase} start cmd=${JSON.stringify(spec.command)} on_error=${spec.onError} mutate=${spec.mutate}`,
    );
    const { status, combined, failed } = spawnHook(
      loop,
      phase,
      spec.command,
      hookEnv,
    );

    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      iterationStr,
      "hook.output",
      `"hook": ${JSON.stringify(phase)}, "exit_code": ${status}, "output": ${JSON.stringify(combined.trim())}`,
    );
    printHookOutput(phase, status, combined.trim(), failed);

    if (!failed && spec.mutate !== "none") {
      const stdoutOnly = combined.split("\n[stderr]\n")[0];
      const directive = parseMutationDirective(stdoutOnly, spec.mutate);
      if (directive) {
        if (spec.mutate === "prompt" && directive.prompt !== undefined) {
          result.mutatedPrompt = directive.prompt;
        } else if (spec.mutate === "event") {
          result.mutatedEvent = {
            topic: directive.topic,
            payload: directive.payload,
          };
        }
      }
    }

    if (!failed) {
      log(loop, "debug", `hook ${phase} ok`);
      continue;
    }

    const msg = firstFailureLine(phase, status, combined);

    switch (spec.onError) {
      case "warn":
        log(loop, "warn", msg);
        break;
      case "block":
        log(loop, "error", `hook ${phase} blocked run: ${msg}`);
        result.blocked = true;
        result.blockedMessage = msg;
        return result;
      case "suspend": {
        // Durable suspend: write versioned state and stop this call site
        // immediately. The run process ends (see stopSuspended in the
        // call sites); a later `autoloop resume` (a fresh process) reads
        // suspend-state.json and continues from `resumeIteration`. This
        // deliberately does NOT block in-process — emit's pre_emit/post_emit
        // hooks run in a disposable subprocess and could never block the
        // harness loop anyway, so in-process phases use the same simple,
        // uniform "stop and let resume pick it back up" contract.
        log(loop, "warn", `hook ${phase} suspended run: ${msg}`);
        const resumeIteration = suspendResumeIteration(phase, opts.iteration);
        writeSuspendState(
          loop.paths.stateDir,
          {
            runId: loop.runtime.runId,
            phase,
            iteration: opts.iteration ?? 0,
            reason: msg,
            hookCommand: spec.command,
            createdAt: new Date().toISOString(),
            resumeIteration,
          },
          loop.paths.journalFile,
        );
        result.suspended = true;
        result.blockedMessage = msg;
        return result;
      }
    }
  }

  return result;
}

function suspendResumeIteration(
  phase: HookPhase,
  iteration: number | undefined,
): number {
  const iter = iteration ?? 0;
  switch (phase) {
    case "pre_run":
      return 1;
    case "pre_iteration":
      return iter;
    case "post_iteration":
    case "post_emit":
      return iter + 1;
    case "pre_emit":
      return iter;
    case "post_run":
      return iter + 1;
    default:
      return iter;
  }
}
