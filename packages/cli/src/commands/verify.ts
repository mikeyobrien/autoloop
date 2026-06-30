// `autoloop verify` — independent post-fire verifier for detached/scheduled
// runs. A bare `completed` is an infra claim with nobody watching; this re-runs
// the run's deterministic acceptance checks out-of-band against its work tree
// and reconciles, so a scheduled false-done is caught (non-zero exit).

import { join } from "node:path";
import { jsonField } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";
import { appendEvent } from "@mobrienv/autoloop-core/journal";
import { readRegistry } from "@mobrienv/autoloop-core/registry/read";
import type { RunRecord } from "@mobrienv/autoloop-core/registry/types";
import {
  postFireCheckCommands,
  verifyPostFire,
} from "@mobrienv/autoloop-harness/postfire-verify";

export function dispatchVerify(args: string[]): void {
  if (args[0] === "--help" || args[0] === "-h") {
    printUsage();
    return;
  }
  let json = false;
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else positionals.push(arg);
  }
  const projectDir = positionals[0] ?? resolveRuntimeProjectDir();
  const runIdArg = positionals[1];
  const stateDir = join(projectDir, ".autoloop");
  const records = readRegistry(join(stateDir, "registry.jsonl"));
  const record = pickRun(records, runIdArg);
  if (!record) {
    console.error(
      runIdArg
        ? `No run "${runIdArg}" in ${projectDir}.`
        : `No completed run to verify in ${projectDir}. Run one to completion, or pass a run-id: autoloop verify ${projectDir} <run-id>.`,
    );
    process.exitCode = 1;
    return;
  }

  const cfg = config.loadProject(record.project_dir || projectDir);
  const cmds = postFireCheckCommands(
    config.getList(cfg, "acceptance.verify_cmds"),
    config.get(cfg, "acceptance.verify_cmd", ""),
    config.getList(cfg, "acceptance.criteria"),
  );
  const timeoutMs = config.getDuration(cfg, "acceptance.timeout", 300000);
  const result = verifyPostFire(record.work_dir, cmds, timeoutMs);

  // Reconcile durably into the run journal.
  if (record.journal_file) {
    try {
      appendEvent(
        record.journal_file,
        record.run_id,
        "",
        "postfire.verify",
        jsonField("reconcile", result.reconcile) +
          ", " +
          jsonField("ran_checks", String(result.ranChecks)) +
          ", " +
          jsonField("failed", String(result.failures.length)),
      );
    } catch {
      /* best-effort: a missing journal must not break the verifier */
    }
  }

  if (json) {
    console.log(JSON.stringify({ run_id: record.run_id, ...result }, null, 2));
  } else {
    console.log(renderVerify(record, result));
  }
  // A false done (or an unverifiable claim) must fail loudly for schedulers/CI.
  if (result.reconcile !== "confirmed") process.exitCode = 1;
}

function pickRun(
  records: RunRecord[],
  runId: string | undefined,
): RunRecord | undefined {
  if (runId) return records.find((r) => r.run_id === runId);
  // Default: the most recently updated completed run.
  return [...records]
    .filter((r) => r.status === "completed")
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
}

function renderVerify(
  record: RunRecord,
  result: ReturnType<typeof verifyPostFire>,
): string {
  const head = `## Post-fire verify — ${record.run_id} → ${result.reconcile}`;
  if (result.reconcile === "unverifiable") {
    return `${head}\n\nNo deterministic acceptance checks configured; the completed claim cannot be independently verified. Add acceptance.verify_cmds.`;
  }
  if (result.reconcile === "confirmed") {
    return `${head}\n\n${result.ranChecks} check(s) passed against ${record.work_dir}.`;
  }
  const lines = result.failures.map(
    (f) => `- \`${f.command}\` exited ${f.exitCode}:\n${f.tail}`,
  );
  return `${head}\n\nFALSE DONE: ${result.failures.length}/${result.ranChecks} check(s) failed against ${record.work_dir}:\n${lines.join("\n\n")}`;
}

function resolveRuntimeProjectDir(): string {
  return process.env.AUTOLOOP_PROJECT_DIR || ".";
}

function printUsage(): void {
  console.log("Usage: autoloop verify [project-dir] [run-id] [--json]");
  console.log("");
  console.log(
    "Independently re-run a completed run's deterministic acceptance",
  );
  console.log(
    "checks out-of-band and reconcile. Exits non-zero on a false done",
  );
  console.log(
    "or an unverifiable claim. Defaults to the latest completed run.",
  );
}
