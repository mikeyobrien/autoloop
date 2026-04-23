import { lineSep } from "@mobrienv/autoloop-core";
import type { ParseResult } from "./types.js";

export function parseParallelObjectives(
  payload: string,
  maxBranches: number,
): ParseResult {
  const lines = payload
    .split(lineSep())
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const objectives: string[] = [];
  let invalid = false;

  for (const line of lines) {
    const obj = parseObjectiveLine(line);
    if (obj === "") invalid = true;
    else objectives.push(obj);
  }

  if (invalid)
    return { ok: false, objectives: [], reason: "invalid_branch_list" };
  if (objectives.length === 0)
    return { ok: false, objectives: [], reason: "empty_branch_list" };
  if (objectives.length > maxBranches)
    return { ok: false, objectives: [], reason: "too_many_branches" };
  return { ok: true, objectives, reason: "" };
}

export function parseObjectiveLine(line: string): string {
  if (line.startsWith("- ") || line.startsWith("* "))
    return line.slice(2).trim();
  const dotIdx = line.indexOf(". ");
  if (dotIdx > 0 && /^\d+$/.test(line.slice(0, dotIdx)))
    return line.slice(dotIdx + 2).trim();
  return "";
}
