import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunRecord } from "./types.js";

export function appendRegistryEntry(path: string, record: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
}
