#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootManifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const packageDirs = [root];
for (const workspace of rootManifest.workspaces ?? []) {
  if (typeof workspace !== "string" || workspace.includes("*")) {
    throw new Error(`unsupported workspace entry: ${String(workspace)}`);
  }
  packageDirs.push(resolve(root, workspace));
}

function confined(packageDir, target) {
  const path = resolve(packageDir, target);
  const prefix = packageDir.endsWith(sep) ? packageDir : `${packageDir}${sep}`;
  if (path !== packageDir && !path.startsWith(prefix)) {
    throw new Error(`export escapes package root: ${target}`);
  }
  return path;
}

function targetFor(entry, condition) {
  if (typeof entry === "string")
    return condition === "default" ? entry : undefined;
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return undefined;
  return (
    entry[condition] ?? (condition === "default" ? entry.import : undefined)
  );
}

let checked = 0;
for (const packageDir of packageDirs) {
  const manifestPath = resolve(packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const exportsMap = manifest.exports;
  if (
    !exportsMap ||
    typeof exportsMap !== "object" ||
    Array.isArray(exportsMap)
  ) {
    throw new Error(
      `${manifest.name ?? packageDir} has no explicit exports map`,
    );
  }

  for (const [subpath, entry] of Object.entries(exportsMap)) {
    const runtimeTarget = targetFor(entry, "default");
    if (!runtimeTarget) {
      throw new Error(
        `${manifest.name}${subpath} has no default/import target`,
      );
    }
    const runtimePath = confined(packageDir, runtimeTarget);
    if (!existsSync(runtimePath) || !statSync(runtimePath).isFile()) {
      throw new Error(
        `${manifest.name}${subpath} runtime target missing: ${runtimeTarget}`,
      );
    }

    const typesTarget = targetFor(entry, "types");
    if (typesTarget) {
      const typesPath = confined(packageDir, typesTarget);
      if (!existsSync(typesPath) || !statSync(typesPath).isFile()) {
        throw new Error(
          `${manifest.name}${subpath} types target missing: ${typesTarget}`,
        );
      }
    }

    if (runtimePath.endsWith(".js")) {
      const runtimeUrl = pathToFileURL(runtimePath).href;
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(runtimeUrl)})`,
        ],
        { cwd: root, stdio: "pipe" },
      );
    } else if (runtimePath.endsWith(".json")) {
      JSON.parse(readFileSync(runtimePath, "utf8"));
    }
    checked += 1;
  }

  const bins =
    typeof manifest.bin === "string"
      ? { [manifest.name]: manifest.bin }
      : (manifest.bin ?? {});
  for (const [name, target] of Object.entries(bins)) {
    if (typeof target !== "string")
      throw new Error(`${name} bin target is not a string`);
    const binPath = confined(packageDir, target);
    if (!existsSync(binPath) || !statSync(binPath).isFile()) {
      throw new Error(`${name} bin target missing: ${target}`);
    }
    checked += 1;
  }
}

console.log(
  `verified ${checked} public export/bin targets across ${packageDirs.length} packages`,
);

// --- Pinned Tier A surface + documented named imports -----------------------
const tierAPinPath = resolve(
  root,
  "test/fixtures/contracts/tier-a-surface.json",
);
const tierAPin = JSON.parse(readFileSync(tierAPinPath, "utf8"));

for (const [pkgName, subpaths] of Object.entries(tierAPin.exports ?? {})) {
  const pkgDir = packageDirs.find((dir) => {
    try {
      return (
        JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")).name ===
        pkgName
      );
    } catch {
      return false;
    }
  });
  if (!pkgDir) throw new Error(`Tier A pin package missing: ${pkgName}`);
  const manifest = JSON.parse(
    readFileSync(resolve(pkgDir, "package.json"), "utf8"),
  );
  const exportsMap = manifest.exports ?? {};
  for (const subpath of subpaths) {
    if (!(subpath in exportsMap)) {
      throw new Error(
        `Tier A export removed or missing: ${pkgName}${subpath === "." ? "" : subpath}`,
      );
    }
  }
}

for (const entry of tierAPin.namedImports ?? []) {
  const names = entry.names ?? [];
  const importList = names.join(", ");
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const mod = await import(${JSON.stringify(entry.specifier)});
       for (const name of ${JSON.stringify(names)}) {
         if (!(name in mod)) {
           throw new Error(${JSON.stringify(entry.specifier)} + " missing export " + name);
         }
       }
       console.log("named-import-ok", ${JSON.stringify(entry.specifier)}, ${JSON.stringify(importList)});`,
    ],
    { cwd: root, stdio: "pipe" },
  );
}

console.log(
  `verified Tier A pin (${Object.keys(tierAPin.exports ?? {}).length} packages) and ${(tierAPin.namedImports ?? []).length} documented named imports`,
);
