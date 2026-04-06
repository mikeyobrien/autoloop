import { existsSync } from "node:fs";
import * as config from "../config.js";
import { get } from "../config.js";

export function dispatchConfig(args: string[]): boolean {
  const sub = args[0] ?? "";

  if (sub === "show") {
    return configShow(args.slice(1));
  }

  if (sub === "path") {
    return configPath();
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
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--project" || args[i] === "-d") && args[i + 1]) {
      projectDir = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      json = true;
    }
  }

  const { config: resolved, provenance } = config.loadLayered(projectDir);

  if (json) {
    console.log(JSON.stringify({ config: resolved, provenance }, null, 2));
    return true;
  }

  console.log("# Resolved configuration (highest-precedence source shown)");
  console.log("");

  for (const section of Object.keys(resolved)) {
    console.log("[" + section + "]");
    const value = resolved[section];
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const dotPath = section + "." + k;
        const source = provenance[dotPath] ?? "default";
        const pad = "  ";
        console.log(pad + k + " = " + JSON.stringify(String(v)) + "    # " + source);
      }
    } else {
      const source = provenance[section] ?? "default";
      console.log("  " + JSON.stringify(String(value)) + "    # " + source);
    }
    console.log("");
  }
  return true;
}

function configPath(): boolean {
  const path = config.userConfigPath();
  const exists = existsSync(path);
  console.log(path);
  console.log(exists ? "exists: yes" : "exists: no");
  return true;
}

function printConfigUsage(): void {
  console.log("Usage: autoloop config <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  show              Show resolved config with provenance labels");
  console.log("  path              Print user config file path and existence");
  console.log("");
  console.log("Options (show):");
  console.log("  --project <dir>   Resolve against a specific project directory");
  console.log("  --json            Output as JSON with config and provenance");
}
