import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAcpIteration, runPiIteration } from "@mobrienv/autoloop-backends";
import {
  initAcpSession,
  terminateAcpSession,
} from "@mobrienv/autoloop-backends/acp-client";
import {
  initPiSession,
  terminatePiSession,
} from "@mobrienv/autoloop-backends/pi-rpc-client";
import { jsonBool, jsonField, jsonFieldRaw } from "@mobrienv/autoloop-core";
import { appendEvent, readRunLines } from "@mobrienv/autoloop-core/journal";
import { reloadLoop } from "./config-helpers.js";
import { buildReviewCommand, runProcess } from "./parallel.js";
import { renderReviewPromptText } from "./prompt.js";
import type { LoopContext, Verdict, VerdictKind } from "./types.js";

export type { Verdict, VerdictKind };

const DEFAULT_VERDICT: Verdict = {
  verdict: "CONTINUE",
  confidence: 0,
  reasoning: "No structured verdict found; defaulting to CONTINUE",
};

export function parseVerdict(output: string): Verdict {
  const match = output.match(/```(?:json)?\s*\n(\{[\s\S]*?\})\s*\n```/);
  if (!match) return DEFAULT_VERDICT;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const v = String(parsed.verdict || "").toUpperCase();
    if (!["CONTINUE", "REDIRECT", "TAKEOVER", "EXIT"].includes(v))
      return DEFAULT_VERDICT;
    return {
      verdict: v as VerdictKind,
      confidence: Number(parsed.confidence) || 0,
      reasoning: String(parsed.reasoning || ""),
      redirect_prompt: parsed.redirect_prompt
        ? String(parsed.redirect_prompt)
        : undefined,
      takeover_output: parsed.takeover_output
        ? String(parsed.takeover_output)
        : undefined,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map(String)
        : undefined,
    };
  } catch {
    return DEFAULT_VERDICT;
  }
}

export async function maybeRunMetareview(
  loop: LoopContext,
  iteration: number,
): Promise<LoopContext> {
  if (shouldRunMetareview(loop, iteration)) {
    const verdict = await runMetareviewReview(loop, iteration);
    const reloaded = reloadLoop(loop);
    reloaded.lastVerdict = verdict;
    return reloaded;
  }
  return loop;
}

export function shouldRunMetareview(
  loop: LoopContext,
  iteration: number,
): boolean {
  if (!loop.review.enabled) return false;
  if (iteration <= 1) return false;
  if (iteration === 2 && loop.review.adversarialFirst) return true;
  return iteration > 1 && (iteration - 1) % loop.review.every === 0;
}

export async function runMetareviewReview(
  loop: LoopContext,
  iteration: number,
): Promise<Verdict> {
  loop.onEvent?.({ type: "review.banner", iteration });
  const runLines = readRunLines(loop.paths.journalFile, loop.runtime.runId);
  const reviewPrompt = renderReviewPromptText(loop, iteration, runLines);

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "review.start",
    jsonField("kind", "metareview") +
      ", " +
      jsonField("backend_kind", loop.review.kind) +
      ", " +
      jsonField("backend_provider", loop.review.provider) +
      ", " +
      jsonField("command", loop.review.command) +
      ", " +
      jsonField("prompt_mode", loop.review.promptMode) +
      ", " +
      jsonField("prompt", reviewPrompt) +
      ", " +
      jsonField("timeout_ms", String(loop.review.timeoutMs)),
  );

  const { output, exitCode, timedOut } =
    loop.review.kind === "acp"
      ? await runAcpReview(loop, reviewPrompt)
      : loop.review.kind === "pi"
        ? await runPiReview(loop, reviewPrompt, iteration)
        : runProcess(
            buildReviewCommand(loop, iteration, reviewPrompt),
            loop.review.timeoutMs,
            loop.review.kind,
          );

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "review.finish",
    jsonField("kind", "metareview") +
      ", " +
      jsonField("exit_code", String(exitCode)) +
      ", " +
      jsonFieldRaw("timed_out", jsonBool(timedOut)) +
      ", " +
      jsonField("output", output),
  );

  const verdict = parseVerdict(output);

  appendEvent(
    loop.paths.journalFile,
    loop.runtime.runId,
    String(iteration),
    "review.verdict",
    jsonField("verdict", verdict.verdict) +
      ", " +
      jsonField("confidence", String(verdict.confidence)) +
      ", " +
      jsonField("reasoning", verdict.reasoning),
  );

  if (verdict.verdict === "REDIRECT" && verdict.redirect_prompt) {
    writeFileSync(
      join(loop.paths.stateDir, "redirect.md"),
      verdict.redirect_prompt,
    );
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iteration),
      "review.redirect",
      jsonField("redirect_prompt", verdict.redirect_prompt),
    );
  } else if (verdict.verdict === "TAKEOVER") {
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iteration),
      "review.takeover",
      jsonField(
        "takeover_output",
        verdict.takeover_output || "(no takeover output)",
      ),
    );
  } else if (verdict.verdict === "EXIT") {
    appendEvent(
      loop.paths.journalFile,
      loop.runtime.runId,
      String(iteration),
      "review.exit",
      jsonField("iteration", String(iteration)) +
        ", " +
        jsonField("reason", verdict.reasoning),
    );
  }

  return verdict;
}

// Reviews get their own ACP session built from the review spec — the live
// iteration session may belong to a different provider/agent/model and
// carries the iteration's conversation context.
/**
 * Run a pi metareview in a dedicated RPC session — never the live iteration
 * session — so the reviewer judges with a clean context window.
 */
async function runPiReview(
  loop: LoopContext,
  reviewPrompt: string,
  iteration: number,
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  const session = await initPiSession({
    command: loop.review.command,
    args: loop.review.args,
    cwd: loop.paths.workDir,
    modelId: loop.review.model || undefined,
    verbose: loop.runtime.logLevel === "debug",
  });
  try {
    return await runPiIteration(
      session,
      reviewPrompt,
      loop.review.timeoutMs,
      join(loop.paths.stateDir, `pi-review.${iteration}.jsonl`),
    );
  } finally {
    try {
      await terminatePiSession(session);
    } catch {
      /* best-effort */
    }
  }
}

async function runAcpReview(
  loop: LoopContext,
  reviewPrompt: string,
): Promise<{ output: string; exitCode: number; timedOut: boolean }> {
  const session = await initAcpSession({
    provider: loop.review.provider,
    command: loop.review.command,
    args: loop.review.args,
    cwd: loop.paths.workDir,
    trustAllTools: loop.review.trustAllTools,
    agentName: loop.review.agent || undefined,
    modelId: loop.review.model || undefined,
    verbose: loop.runtime.logLevel === "debug",
  });
  try {
    return await runAcpIteration(session, reviewPrompt, loop.review.timeoutMs);
  } finally {
    try {
      await terminateAcpSession(session);
    } catch {
      /* best-effort */
    }
  }
}
