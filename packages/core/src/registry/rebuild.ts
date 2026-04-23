import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deriveRunRecords } from "./derive.js";

/**
 * Rebuild the registry JSONL from the canonical journal.
 * Overwrites the registry file with derived state.
 */
export function rebuildRegistry(
  journalPath: string,
  registryPath: string,
): void {
  if (!existsSync(journalPath)) return;
  const text = readFileSync(journalPath, "utf-8");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const records = deriveRunRecords(lines);
  mkdirSync(dirname(registryPath), { recursive: true });
  const content =
    records.map((r) => JSON.stringify(r)).join("\n") +
    (records.length > 0 ? "\n" : "");
  writeFileSync(registryPath, content, "utf-8");
}
