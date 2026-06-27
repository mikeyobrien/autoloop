// `autoloop acp` — present an Agent Client Protocol interface over stdio.
//
// The calling process speaks ACP to autoloop: it can list slash commands,
// send prompts that map to autoloop CLI verbs, stream loop output as tool
// calls, and start/stop the dashboard to get a clickable URL.

import { resolve } from "node:path";
import { serveAcp } from "../acp/serve.js";

export async function dispatchAcp(
  args: string[],
  bundleRoot: string,
  selfCmd: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") {
    printAcpUsage();
    return;
  }

  let projectDir = process.env.AUTOLOOP_PROJECT_DIR || ".";
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project-dir" && args[i + 1]) {
      projectDir = args[i + 1];
      i++;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    }
  }

  await serveAcp(
    {
      bundleRoot,
      selfCmd,
      projectDir: resolve(projectDir),
      verbose,
    },
    input,
    output,
  );
}

function printAcpUsage(): void {
  console.log("Usage: autoloop acp [options]");
  console.log("");
  console.log(
    "Present an Agent Client Protocol (ACP) interface over stdio. The calling",
  );
  console.log(
    "process drives autoloop: slash commands map to autoloop CLI verbs, loop",
  );
  console.log("runs stream as tool calls, and the dashboard returns a URL.");
  console.log("");
  console.log("Options:");
  console.log(
    "  --project-dir <dir>  Default project directory if the ACP client does",
  );
  console.log(
    "                       not set one via session/new cwd (default: .)",
  );
  console.log("  --verbose, -v        Surface debug logs as agent thoughts");
  console.log("  --help, -h           Show this help");
  console.log("");
  console.log(
    "The working directory is per session: ACP clients set it via the",
  );
  console.log(
    "session/new `cwd` field. --project-dir only supplies the fallback.",
  );
}
