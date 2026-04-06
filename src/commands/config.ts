import * as config from "../config.js";
import { get } from "../config.js";

export function dispatchConfig(args: string[]): boolean {
  const sub = args[0] ?? "";

  if (sub === "show") {
    return configShow(args.slice(1));
  }

  if (sub === "--help" || sub === "-h" || sub === "") {
    printConfigUsage();
    return true;
  }

  console.log("unknown config subcommand: " + sub);
  printConfigUsage();
  return true;
}

function configShow(args: string[]): boolean {
  let projectDir = ".";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--project" || args[i] === "-d") && args[i + 1]) {
      projectDir = args[i + 1];
      i++;
    }
  }

  const { config: resolved, provenance } = config.loadLayered(projectDir);

  for (const section of Object.keys(resolved)) {
    const source = provenance[section] ?? "default";
    console.log("[" + section + "] (source: " + source + ")");
    const value = resolved[section];
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        console.log("  " + k + " = " + JSON.stringify(String(v)));
      }
    } else {
      console.log("  " + JSON.stringify(String(value)));
    }
    console.log("");
  }
  return true;
}

function printConfigUsage(): void {
  console.log("Usage: autoloop config <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  show              Show resolved config with provenance labels");
  console.log("");
  console.log("Options:");
  console.log("  --project <dir>   Resolve against a specific project directory");
}
