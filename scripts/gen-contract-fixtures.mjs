#!/usr/bin/env node
/**
 * Deterministic generator for the committed compatibility fixtures in
 * `test/fixtures/contracts/`.
 *
 * Fixtures are produced through the *real* writers (`encodeEvent` for the
 * journal, `appendRegistryEntry` for the registry) so the committed bytes are a
 * true record of current on-disk behavior rather than hand-authored JSON.
 *
 * Determinism rules (asserted by `test/integration/compat-contract.test.ts`):
 *   - timestamps are frozen literals, never `Date.now()`;
 *   - no `pid`, no host-specific absolute paths;
 *   - inputs are fixed literals, so two runs are byte-identical.
 *
 * Usage:
 *   npm run fixtures:contracts                       # rewrite committed fixtures
 *   AUTOLOOP_FIXTURE_OUT_DIR=/tmp/x npm run fixtures:contracts   # write elsewhere
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeEvent } from "@mobrienv/autoloop-core";
import { appendRegistryEntry } from "@mobrienv/autoloop-core/registry/update";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR =
  process.env.AUTOLOOP_FIXTURE_OUT_DIR || join(ROOT, "test/fixtures/contracts");

/** Frozen clock factory: yields a fixed ISO timestamp per event. */
function frozenClock(iso) {
  return () => iso;
}

const RUN_ID = "test-golden-run-1";

const JOURNAL_EVENTS = [
  {
    ts: "2021-01-01T00:00:00.000Z",
    event: {
      shape: "payload",
      run: RUN_ID,
      iteration: "0",
      topic: "recon.done",
      payload: "Recon complete",
      source: "harness",
    },
  },
  {
    ts: "2021-01-01T00:00:01.000Z",
    event: {
      shape: "payload",
      run: RUN_ID,
      iteration: "1",
      topic: "plan.ready",
      payload: "Plan ready",
      source: "harness",
    },
  },
  {
    ts: "2021-01-01T00:00:02.000Z",
    event: {
      shape: "payload",
      run: RUN_ID,
      iteration: "1",
      topic: "red.ready",
      payload: "Tests written",
      source: "agent",
    },
  },
  {
    ts: "2021-01-01T00:00:03.000Z",
    event: {
      shape: "payload",
      run: RUN_ID,
      iteration: "2",
      topic: "task.complete",
      payload: "Loop completed",
      source: "operator",
    },
  },
  {
    ts: "2021-01-01T00:00:04.000Z",
    event: {
      shape: "fields",
      run: RUN_ID,
      iteration: "2",
      topic: "loop.stop",
      fields: { reason: "completed", exit_code: "0" },
    },
  },
];

/** Shared, host-independent record skeleton. */
function record(overrides) {
  return {
    run_id: "",
    status: "running",
    preset: "minimal",
    objective: "Deterministic compatibility fixture",
    trigger: "manual",
    project_dir: "/tmp/fixture-project",
    work_dir: "/tmp/fixture-project",
    state_dir: "/tmp/fixture-project/.autoloop",
    journal_file: "/tmp/fixture-project/.autoloop/journal.jsonl",
    parent_run_id: "",
    backend: "mock",
    backend_args: [],
    created_at: "2021-01-01T00:00:00.000Z",
    updated_at: "2021-01-01T00:00:00.000Z",
    iteration: 0,
    max_iterations: 10,
    stop_reason: "",
    latest_event: "",
    isolation_mode: "none",
    worktree_name: "",
    worktree_path: "",
    ...overrides,
  };
}

const REGISTRY_RECORDS = [
  // First-seen run: later superseded by a duplicate run_id (last-write-wins).
  record({
    run_id: "run-aaaa-0001",
    status: "running",
    latest_event: "plan.ready",
    iteration: 1,
  }),
  // A distinct run that stays `running` so `activeRuns` has a stable subject.
  record({
    run_id: "run-bbbb-0002",
    status: "running",
    objective: "Second deterministic fixture run",
    latest_event: "red.ready",
    iteration: 2,
    updated_at: "2021-01-01T00:01:00.000Z",
  }),
  // Duplicate of run-aaaa-0001 in a terminal status; pins dedupe semantics.
  record({
    run_id: "run-aaaa-0001",
    status: "completed",
    latest_event: "task.complete",
    iteration: 4,
    max_iterations: 10,
    stop_reason: "completed",
    updated_at: "2021-01-01T00:02:00.000Z",
  }),
];

mkdirSync(OUT_DIR, { recursive: true });

const journalPath = join(OUT_DIR, "journal-v1-minimal.jsonl");
writeFileSync(
  journalPath,
  JOURNAL_EVENTS.map(({ event, ts }) =>
    encodeEvent(event, frozenClock(ts)),
  ).join(""),
  "utf-8",
);

const registryPath = join(OUT_DIR, "registry-v1-minimal.jsonl");
rmSync(registryPath, { force: true });
for (const entry of REGISTRY_RECORDS) appendRegistryEntry(registryPath, entry);

process.stdout.write(`wrote ${journalPath}\nwrote ${registryPath}\n`);
