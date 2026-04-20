import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runKiroIterationSync } from "../backend/kiro-bridge.js";
import { jsonBool, jsonField, jsonFieldRaw } from "../json.js";
import { reloadLoop } from "./config-helpers.js";
import { appendEvent, readRunLines } from "./journal.js";
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

export function maybeRunMetareview(
  loop: LoopContext,
  iteration: number,
): LoopContext {
  if (shouldRunMetareview(loop, iteration)) {
    const verdict = runMetareviewReview(loop, iteration);
    const reloaded = reloadLoop(loop);
    reloaded.kiroSession = loop.kiroSession;
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
  if (iteration === 1 && loop.review.adversarialFirst) return true;
  return iteration > 1 && (iteration - 1) % loop.review.every === 0;
}

export function runMetareviewReview(
  loop: LoopContext,
  iteration: number,
): Verdict {
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
      jsonField("command", loop.review.command) +
      ", " +
      jsonField("prompt_mode", loop.review.promptMode) +
      ", " +
      jsonField("prompt", reviewPrompt) +
      ", " +
      jsonField("timeout_ms", String(loop.review.timeoutMs)),
  );

  const { output, exitCode, timedOut } =
    loop.review.kind === "kiro" && loop.kiroSession
      ? runKiroIterationSync(
          loop.kiroSession,
          reviewPrompt,
          loop.review.timeoutMs,
        )
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
