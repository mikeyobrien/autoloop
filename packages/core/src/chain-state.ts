import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { DEFAULT_STATE_DIR } from "./config-schema.js";

export const CHAIN_STEP_STATE_FILE = "state-layout.json";

interface ChainStepStateMetadata {
  version: 1;
  state_dir: string;
}

export interface ChainStepStateLayout {
  stepDir: string;
  stateDir: string;
  stateDirRel: string;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function statePath(stepDir: string, stateDirRel: string): string {
  return isAbsolute(stateDirRel) ? stateDirRel : join(stepDir, stateDirRel);
}

function readRecordedStateDir(stepDir: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(stepDir, CHAIN_STEP_STATE_FILE), "utf-8"),
    ) as Partial<ChainStepStateMetadata>;
    if (
      parsed.version !== 1 ||
      typeof parsed.state_dir !== "string" ||
      parsed.state_dir.trim() === ""
    ) {
      return null;
    }
    return parsed.state_dir;
  } catch {
    return null;
  }
}

/** Record the configured state layout before a chain child starts. */
export function writeChainStepStateLayout(
  stepDir: string,
  stateDirRel: string,
): void {
  mkdirSync(stepDir, { recursive: true });
  const metadata: ChainStepStateMetadata = {
    version: 1,
    state_dir: stateDirRel,
  };
  writeFileSync(
    join(stepDir, CHAIN_STEP_STATE_FILE),
    `${JSON.stringify(metadata)}\n`,
    "utf-8",
  );
}

/**
 * Return each chain step's bounded state roots. New runs use their recorded
 * child layout. Runs created before metadata existed fall back to both the
 * default child root and the parent layout.
 */
export function discoverChainStepStateLayouts(
  stateDir: string,
  parentStateDirRel: string = DEFAULT_STATE_DIR,
): ChainStepStateLayout[] {
  const layouts: ChainStepStateLayout[] = [];
  for (const chainDir of listDirs(join(stateDir, "chains"))) {
    for (const stepDir of listDirs(chainDir)) {
      const stepName = stepDir.slice(chainDir.length + 1);
      if (!/^step-\d+$/.test(stepName)) continue;

      const recorded = readRecordedStateDir(stepDir);
      const candidates = recorded
        ? [recorded]
        : [...new Set([DEFAULT_STATE_DIR, parentStateDirRel])];
      for (const stateDirRel of candidates) {
        layouts.push({
          stepDir,
          stateDir: statePath(stepDir, stateDirRel),
          stateDirRel,
        });
      }
    }
  }
  return layouts;
}
