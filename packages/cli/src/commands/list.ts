import * as chains from "../chains.js";

export function dispatchList(args: string[], bundleRoot: string): boolean {
  if (args[0] === "--help") {
    console.log("Usage: autoloop list\n\nLists all bundled presets.");
    return true;
  }
  const presets = chains.listPresetsWithDescriptions(bundleRoot);
  const maxName = Math.max(...presets.map((p) => p.name.length));
  for (const { name, description } of presets) {
    const pad = " ".repeat(maxName - name.length + 2);
    console.log(description ? `${name}${pad}${description}` : name);
  }
  return true;
}
