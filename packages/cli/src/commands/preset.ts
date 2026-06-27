import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as config from "@mobrienv/autoloop-core/config";
import * as topo from "@mobrienv/autoloop-core/topology";
import { fail } from "../cli/fail.js";

/**
 * `autoloop preset promote <source.toml> <name>` — graduate a generated (or
 * hand-written) single-file preset into a permanent named preset under the user
 * presets dir, after statically validating it. This is how a good generated
 * design becomes reusable (RFC docs/rfcs/2026-06-24-dynamic-presets-design.md).
 */
export function dispatchPreset(args: string[]): boolean {
  const sub = args[0] ?? "";
  if (sub === "" || sub === "--help" || sub === "-h") {
    printPresetUsage();
    return true;
  }
  if (sub === "promote") {
    return promote(args.slice(1));
  }
  fail([
    `error: unknown preset subcommand \`${sub}\``,
    "Usage: autoloop preset promote <source.toml> <name>",
  ]);
  return true;
}

function promote(args: string[]): boolean {
  const source = args[0] ?? "";
  const name = args[1] ?? "";
  if (!source || !name) {
    fail([
      "error: preset promote requires a source file and a name",
      "Usage: autoloop preset promote <source.toml> <name>",
    ]);
    return true;
  }
  if (!existsSync(source)) {
    fail([`error: source preset not found: ${source}`]);
    return true;
  }

  // Validate before promoting — never enshrine a dead topology.
  const topology = topo.loadTopologyFromFile(source);
  const warnings = topo.validateTopology(topology, { singleFile: true });
  if (warnings.length > 0) {
    fail([
      `error: ${source} has validation warnings; not promoting:`,
      ...warnings.map((w) => `  - ${w.message}`),
    ]);
    return true;
  }

  const destDir = config.userPresetsDir();
  const dest = join(destDir, `${name}.toml`);
  if (existsSync(dest)) {
    fail([
      `error: preset \`${name}\` already exists at ${dest}`,
      "Choose a different name or remove the existing file.",
    ]);
    return true;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  console.log(`promoted ${source} -> ${dest}`);
  console.log(`run it with: autoloop run ${name} "<objective>"`);
  return true;
}

function printPresetUsage(): void {
  console.log("Usage: autoloop preset promote <source.toml> <name>");
  console.log("");
  console.log(
    "  promote   Validate a single-file preset and install it under the user",
  );
  console.log("            presets dir as a permanent named preset.");
}
