import type { CapabilityVerb, ControlCapabilities } from "./types.js";

export const CAPABILITY_VERBS: CapabilityVerb[] = [
  "guidance",
  "interrupt",
  "inspect",
];

/**
 * Default capabilities every backend inherits. `guidance` and `inspect` are
 * journal-derived and always available; `interrupt` is off unless the adapter
 * overrides it.
 */
export function defaultCapabilities(
  backend: string,
  runId: string,
): ControlCapabilities {
  return {
    backend,
    runId,
    publishedAt: new Date().toISOString(),
    guidance: { supported: true },
    inspect: { supported: true },
    interrupt: {
      supported: false,
      detail: "backend has no in-flight interrupt",
    },
  };
}

export function supportsInterrupt(caps: ControlCapabilities | null): boolean {
  return caps?.interrupt?.supported === true;
}
