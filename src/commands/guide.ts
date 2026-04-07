import { resolveEmitJournalFile } from "../harness/emit.js";
import { appendOperatorEvent, latestRunId } from "../harness/journal.js";

export function dispatchGuide(args: string[]): void {
  let runId = "";
  let messageArgs = args;

  // Parse optional --run flag
  if (args[0] === "--run" && args[1]) {
    runId = args[1];
    messageArgs = args.slice(2);
  }

  if (
    messageArgs.length === 0 ||
    messageArgs[0] === "--help" ||
    messageArgs[0] === "-h"
  ) {
    console.log(
      'Usage: autoloops guide [--run <runId>] "guidance message"\n' +
        "Inject operator guidance into the next loop iteration.",
    );
    return;
  }

  const message = messageArgs.join(" ");
  const projectDir = process.env.AUTOLOOP_PROJECT_DIR || ".";
  const journalFile = resolveEmitJournalFile(projectDir);

  if (!runId) {
    runId = process.env.AUTOLOOP_RUN_ID || latestRunId(journalFile);
  }

  if (!runId) {
    process.stderr.write(
      "No active run found. Specify --run <runId> or ensure a loop is running.\n",
    );
    process.exitCode = 1;
    return;
  }

  appendOperatorEvent(journalFile, runId, "", "operator.guidance", message);
  console.log(`Guidance queued for next iteration of run ${runId}`);
  process.exitCode = 0;
}
