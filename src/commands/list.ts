import * as chains from "../chains.js";

export function dispatchList(args: string[]): boolean {
  if (args[0] === "--help") {
    console.log("Usage: autoloops-ts list\n\nLists all bundled presets.");
    return true;
  }
  for (const preset of chains.listKnownPresets()) {
    console.log(preset);
  }
  return true;
}
