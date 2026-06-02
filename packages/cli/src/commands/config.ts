import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolvePresetDir } from "@mobrienv/autoloop-core";
import * as config from "@mobrienv/autoloop-core/config";

export function dispatchConfig(args: string[]): boolean {
  const sub = args[0] ?? "";

  if (sub === "show") {
    return configShow(args.slice(1));
  }

  if (sub === "set") {
    return configSet(args.slice(1));
  }

  if (sub === "path") {
    return configPath();
  }

  if (sub === "--help" || sub === "-h" || sub === "") {
    printConfigUsage();
    return true;
  }

  console.log(`unknown config subcommand: ${sub}`);
  printConfigUsage();
  return true;
}

function configShow(args: string[]): boolean {
  let projectDir = ".";
  let json = false;
  let presetName = "";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--project" || args[i] === "-d") && args[i + 1]) {
      projectDir = args[i + 1];
      i++;
    } else if (args[i] === "--preset" && args[i + 1]) {
      presetName = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--explain") {
      // Provenance is always printed; keep --explain as the readable UX alias.
    }
  }

  const targetDir = presetName
    ? resolvePresetDir(presetName, projectDir)
    : projectDir;
  const { config: resolved, provenance } = config.loadLayered(targetDir, {
    presetName: presetName || undefined,
    workDir: presetName ? projectDir : undefined,
  });

  if (json) {
    console.log(JSON.stringify({ config: resolved, provenance }, null, 2));
    return true;
  }

  console.log("# Resolved configuration (highest-precedence source shown)");
  console.log("");

  for (const section of Object.keys(resolved)) {
    console.log(`[${section}]`);
    const value = resolved[section];
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const dotPath = `${section}.${k}`;
        const source = provenance[dotPath] ?? "default";
        console.log(`  ${k} = ${JSON.stringify(String(v))}    # ${source}`);
      }
    } else {
      const source = provenance[section] ?? "default";
      console.log(`  ${JSON.stringify(String(value))}    # ${source}`);
    }
    console.log("");
  }
  return true;
}

function configSet(args: string[]): boolean {
  let scope: "user" | "repo" | "" = "";
  let projectDir = ".";
  let presetName = "";
  let assignment = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--user") {
      scope = "user";
    } else if (arg === "--repo") {
      scope = "repo";
    } else if ((arg === "--project" || arg === "-d") && args[i + 1]) {
      projectDir = args[++i];
    } else if (arg === "--preset" && args[i + 1]) {
      presetName = args[++i];
    } else if (!assignment) {
      assignment = arg;
    } else {
      console.log(`unexpected config set argument: ${arg}`);
      printConfigUsage();
      return true;
    }
  }

  if (!scope || !presetName || !assignment) {
    console.log(
      "Usage: autoloop config set (--user|--repo) --preset <name> [--project <dir>] key=value",
    );
    return true;
  }

  const parsed = parseAssignment(assignment);
  if (!parsed) {
    console.log(`invalid assignment: ${assignment}`);
    console.log("Expected key=value, e.g. event_loop.max_iterations=250");
    return true;
  }

  const path =
    scope === "user"
      ? config.userPresetOverridePath(presetName)
      : config.repoPresetOverridePath(projectDir, presetName);
  const current = existsSync(path)
    ? config.stringifyValues(config.parseRawToml(readFileSync(path, "utf-8")))
    : {};
  const next = config.put(current, parsed.key, parsed.value);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyConfigToml(next));
  console.log(`set ${parsed.key}=${parsed.value} in ${path}`);
  return true;
}

function stringifyConfigToml(cfg: Record<string, unknown>): string {
  const chunks = stringifyTomlSections(cfg, []);
  return `${chunks.join("\n\n")}\n`;
}

function stringifyTomlSections(
  cfg: Record<string, unknown>,
  prefix: string[],
): string[] {
  const scalars: string[] = [];
  const sections: string[] = [];

  for (const [key, value] of Object.entries(cfg)) {
    if (isPlainObject(value)) {
      sections.push(...stringifyTomlSections(value, [...prefix, key]));
    } else {
      scalars.push(`${key} = ${JSON.stringify(String(value))}`);
    }
  }

  const current =
    scalars.length === 0
      ? []
      : [
          prefix.length > 0
            ? `[${prefix.join(".")}]\n${scalars.join("\n")}`
            : scalars.join("\n"),
        ];
  return [...current, ...sections];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssignment(value: string): { key: string; value: string } | null {
  const eq = value.indexOf("=");
  if (eq <= 0) return null;
  const key = value.slice(0, eq).trim();
  const parsedValue = value.slice(eq + 1).trim();
  if (!key || !parsedValue) return null;
  return { key, value: parsedValue };
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
  console.log(
    "  show              Show resolved config with provenance labels",
  );
  console.log(
    "  set               Write a user/repo preset override: config set (--user|--repo) --preset <name> key=value",
  );
  console.log("  path              Print user config file path and existence");
  console.log("");
  console.log("Options (show):");
  console.log(
    "  --project <dir>   Resolve against a specific project directory",
  );
  console.log(
    "  --preset <name>   Resolve a preset plus preset override layers",
  );
  console.log("  --explain         Alias for provenance display");
  console.log("  --json            Output as JSON with config and provenance");
}
