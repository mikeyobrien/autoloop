import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { awaitHumanResponse } from "@mobrienv/autoloop-harness/ask";
import {
  appendRequest,
  buildRequest,
  pendingRequests,
  readStatuses,
} from "@mobrienv/autoloop-harness/control";
import type { RespondPayload } from "@mobrienv/autoloop-harness/control/types";
import { describe, expect, it } from "vitest";

function tmpStateDir(): string {
  return mkdtempSync(join(tmpdir(), "autoloop-ask-"));
}

function respond(
  stateDir: string,
  runId: string,
  questionId: string,
  answer: string,
): void {
  const payload: RespondPayload = { questionId, answer };
  appendRequest(stateDir, buildRequest(runId, "respond", payload, "respond"));
}

describe("awaitHumanResponse", () => {
  it("returns the answer from a matching respond request and acks it", async () => {
    const dir = tmpStateDir();
    respond(dir, "run-1", "ask_run-1_1", "use approach B");

    const answer = await awaitHumanResponse({
      stateDir: dir,
      runId: "run-1",
      questionId: "ask_run-1_1",
      timeoutMs: 2000,
      pollMs: 10,
    });

    expect(answer).toBe("use approach B");
    // The consumed respond is acked so it no longer lingers as pending.
    expect(pendingRequests(dir)).toHaveLength(0);
    expect(readStatuses(dir).some((s) => s.verb === "respond")).toBe(true);
  });

  it("ignores respond requests for a different questionId or run", async () => {
    const dir = tmpStateDir();
    respond(dir, "run-1", "ask_run-1_99", "for another question");
    respond(dir, "run-2", "ask_run-1_1", "for another run");

    const answer = await awaitHumanResponse({
      stateDir: dir,
      runId: "run-1",
      questionId: "ask_run-1_1",
      timeoutMs: 150,
      pollMs: 10,
    });

    expect(answer).toBeNull(); // timed out — no matching respond
  });

  it("returns null on timeout when no response arrives", async () => {
    const dir = tmpStateDir();
    const answer = await awaitHumanResponse({
      stateDir: dir,
      runId: "run-1",
      questionId: "ask_run-1_1",
      timeoutMs: 120,
      pollMs: 10,
    });
    expect(answer).toBeNull();
  });

  it("returns null promptly when the run is aborted", async () => {
    const dir = tmpStateDir();
    const controller = new AbortController();
    controller.abort();

    const answer = await awaitHumanResponse({
      stateDir: dir,
      runId: "run-1",
      questionId: "ask_run-1_1",
      timeoutMs: 10000,
      pollMs: 10,
      signal: controller.signal,
    });
    expect(answer).toBeNull();
  });

  it("picks up a response that arrives after the wait has started", async () => {
    const dir = tmpStateDir();
    const pending = awaitHumanResponse({
      stateDir: dir,
      runId: "run-1",
      questionId: "ask_run-1_2",
      timeoutMs: 3000,
      pollMs: 10,
    });
    // Deliver the answer shortly after the poll loop is running.
    setTimeout(
      () => respond(dir, "run-1", "ask_run-1_2", "delivered late"),
      40,
    );

    expect(await pending).toBe("delivered late");
  });
});
